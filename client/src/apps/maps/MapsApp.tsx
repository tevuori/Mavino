import { useEffect, useRef, useState, useCallback } from "react";
import {
  Map as LeafletMap,
  TileLayer,
  Marker,
  Polyline,
  LayerGroup,
  Icon,
  DivIcon,
  Control,
  latLng,
  latLngBounds,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Search,
  Route,
  Droplets,
  BedDouble,
  Landmark,
  Utensils,
  Save,
  Trash2,
  Map as MapIcon,
  Loader2,
  X,
  Plus,
  FolderOpen,
  MapPin,
  CalendarDays,
} from "lucide-react";
import type { WindowInstance } from "../../store/windows";
import { useMaps, type MapCommand, type MapPoi, type MapWaypoint } from "../../store/maps";
import { confirmDialog, promptDialog } from "../../store/mobileDialog";
import {
  mapyApi,
  type GeocodeItem,
  type PoiItem,
  type TripSummary,
  type TripDetail,
} from "../../services/maps";
import TourPlanner from "./TourPlanner";

// ===== Mapy.cz tile layers =====
// The `outdoor` mapset shows hiking/tourist trails with markings — the default
// for a hiking-focused app. Auth via the apikey query param (tiles load as <img>).

type Mapset = "outdoor" | "basic" | "aerial" | "winter";

function tileUrl(apiKey: string, mapset: Mapset): string {
  return `https://api.mapy.com/v1/maptiles/${mapset}/256/{z}/{x}/{y}?apikey=${encodeURIComponent(apiKey)}`;
}

const MAPY_ATTRIBUTION =
  '<a href="https://api.mapy.com/copyright" target="_blank">&copy; Seznam.cz a.s. a další</a>';

// ===== Marker icons (color-coded by category, with symbols) =====
const CATEGORY_COLORS: Record<string, string> = {
  water: "#0ea5e9",
  sleeping: "#8b5cf6",
  landmarks: "#f59e0b",
  amenities: "#10b981",
  poi: "#6366f1",
  route: "#ef4444",
  waypoint: "#3b82f6",
  overnight: "#a855f7",
  wildcamp: "#dc2626",
};

/** Inline SVG paths for each category — white symbol on colored circle. */
const CATEGORY_SYMBOLS: Record<string, string> = {
  // Water drop
  water: '<path d="M12 2C12 2 6 10 6 14a6 6 0 0 0 12 0c0-4-6-12-6-12z" fill="white"/>',
  // Bed
  sleeping: '<path d="M3 7v10h2v-3h14v3h2V10c0-1.7-1.3-3-3-3H3zm2 2h12c.6 0 1 .4 1 1v2H5V9z" fill="white"/>',
  // Star/landmark
  landmarks: '<path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6L12 2z" fill="white"/>',
  // Fork & knife (food/amenities)
  amenities: '<path d="M6 2v7c0 1.1.9 2 2 2v9h2V2H8v7H6V2zm10 0c-1.7 0-3 2.2-3 5s1.3 5 3 5v8h2V2h-2z" fill="white"/>',
  // Tent (overnight)
  overnight: '<path d="M12 4L3 20h18L12 4zm0 4l5 9H7l5-9z" fill="white"/>',
  // Wild camp (fire/camp)
  wildcamp: '<path d="M12 2c0 3-2 4-2 7 0 2 1 3 2 3s2-1 2-3c0-3-2-4-2-7zm-4 8c-1 2-2 3-2 5 0 3 3 5 6 5s6-2 6-5c0-2-1-3-2-5" fill="none" stroke="white" stroke-width="1.5"/>',
  // Default dot
  poi: '<circle cx="12" cy="12" r="5" fill="white"/>',
};

function categoryIcon(category: string): DivIcon {
  const color = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.poi;
  const symbol = CATEGORY_SYMBOLS[category] ?? CATEGORY_SYMBOLS.poi;
  const size = category === "overnight" || category === "wildcamp" ? 28 : 24;
  return new DivIcon({
    className: "athena-map-pin",
    html: `<div style="position:relative;width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">
        <circle cx="12" cy="12" r="11" fill="${color}" stroke="white" stroke-width="2"/>
        ${symbol}
      </svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function pinIcon(color: string): DivIcon {
  return new DivIcon({
    className: "athena-map-pin",
    html: `<span style="display:block;width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 20],
  });
}

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export default function MapsApp({ win }: { win: WindowInstance }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const apiKeyRef = useRef<string | null>(null);
  const layersRef = useRef<Record<Mapset, TileLayer>>(null as any);
  const markersLayerRef = useRef<LayerGroup | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  /** Mirror of addStopOnClick for use inside the map click handler (which is
   *  registered once but needs to read the current toggle value). */
  const addStopOnClickRef = useRef(false);
  const currentRouteRef = useRef<{
    geometry: [number, number][];
    pois: MapPoi[];
    waypoints: MapWaypoint[];
    type?: string;
    distanceM?: number;
    durationS?: number;
  } | null>(null);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState(true);
  const [mapset, setMapset] = useState<Mapset>("outdoor");
  const [error, setError] = useState<string | null>(null);

  // Sidebar UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeItem[]>([]);
  const [searching, setSearching] = useState(false);
  // Stops list for the route planner. First = Start, last = End, middle = Via.
  const [stops, setStops] = useState<string[]>(["", ""]);
  const [addStopOnClick, setAddStopOnClick] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"route" | "tour">("route");
  const [routeMode, setRouteMode] = useState<"hiking" | "bicycle" | "car">("hiking");
  const [planning, setPlanning] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distanceM: number; durationS: number; ascentM: number; descentM: number } | null>(null);
  const [findingNearby, setFindingNearby] = useState(false);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<MapPoi | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const issueCommand = useMaps((s) => s.issueCommand);
  const setCenter = useMaps((s) => s.setCenter);
  const removeWindow = useMaps((s) => s.removeWindow);
  const pendingCommand = useMaps((s) => s.commands[win.id]);

  // ===== Load API key =====
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { configured } = await mapyApi.credentialsStatus();
        if (!configured) {
          setLoadingKey(false);
          return;
        }
        const { apiKey: key } = await mapyApi.getApiKey();
        if (!cancelled) {
          setApiKey(key);
          apiKeyRef.current = key;
          setLoadingKey(false);
        }
      } catch {
        if (!cancelled) setLoadingKey(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ===== Initialize Leaflet map once the API key is available =====
  useEffect(() => {
    if (!apiKey || !containerRef.current || mapRef.current) return;
    const map = new LeafletMap(containerRef.current, {
      center: latLng(49.8, 15.5), // Czech Republic center
      zoom: 8,
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    const key = apiKey;
    const layers: Record<Mapset, TileLayer> = {
      outdoor: new TileLayer(tileUrl(key, "outdoor"), {
        minZoom: 0, maxZoom: 20, attribution: MAPY_ATTRIBUTION,
      }),
      basic: new TileLayer(tileUrl(key, "basic"), {
        minZoom: 0, maxZoom: 20, attribution: MAPY_ATTRIBUTION,
      }),
      aerial: new TileLayer(tileUrl(key, "aerial"), {
        minZoom: 0, maxZoom: 20, attribution: MAPY_ATTRIBUTION,
      }),
      winter: new TileLayer(tileUrl(key, "winter"), {
        minZoom: 0, maxZoom: 20, attribution: MAPY_ATTRIBUTION,
      }),
    };
    layersRef.current = layers;
    layers.outdoor.addTo(map);
    markersLayerRef.current = new LayerGroup().addTo(map);
    routeLayerRef.current = new LayerGroup().addTo(map);

    // Mapy.com requires their logo over the map.
    const LogoControl = Control.extend({
      options: { position: "bottomleft" },
      onAdd: () => {
        const c = document.createElement("div");
        const a = document.createElement("a");
        a.setAttribute("href", "https://mapy.com/");
        a.setAttribute("target", "_blank");
        a.innerHTML = '<img src="https://api.mapy.com/img/api/logo.svg" alt="Mapy.com" style="height:20px" />';
        c.appendChild(a);
        return c;
      },
    });
    new (LogoControl as any)().addTo(map);

    // Report center changes to the store (for Athena context).
    const reportCenter = () => {
      const c = map.getCenter();
      setCenter(win.id, c.lat, c.lng, map.getZoom());
    };
    map.on("moveend", reportCenter);
    map.on("zoomend", reportCenter);
    reportCenter();

    // Click-to-add-stop: when addStopOnClick is true, a click reverse-geocodes
    // the point and appends it as a via stop (before the end). The handler is
    // registered once; it reads the ref so the toggle takes effect live.
    map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
      if (!addStopOnClickRef.current) return;
      const { lat, lng } = e.latlng;
      // Reverse-geocode to get a name; fall back to "lat,lon".
      (async () => {
        try {
          const { items } = await mapyApi.reverse(lat, lng);
          const name = items[0]?.name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          setStops((prev) => {
            const next = [...prev];
            // Insert before the last (end) stop.
            next.splice(next.length - 1, 0, name);
            return next;
          });
        } catch {
          setStops((prev) => {
            const next = [...prev];
            next.splice(next.length - 1, 0, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
            return next;
          });
        }
      })();
    });

    // Fix tile rendering after the container becomes visible (Leaflet mis-sizes
    // when initialized inside a hidden/animating window).
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // ===== Layer switching =====
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    Object.values(layers).forEach((l) => {
      if (map.hasLayer(l)) map.removeLayer(l);
    });
    layers[mapset].addTo(map);
  }, [mapset]);

  // Keep the click-to-add-stop ref in sync with the toggle state.
  useEffect(() => {
    addStopOnClickRef.current = addStopOnClick;
  }, [addStopOnClick]);

  // ===== Cleanup on unmount =====
  useEffect(() => {
    return () => removeWindow(win.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Helpers to manipulate markers + routes =====
  const clearLayers = useCallback(() => {
    markersLayerRef.current?.clearLayers();
    routeLayerRef.current?.clearLayers();
    setSelectedPoi(null);
  }, []);

  const addMarker = useCallback((poi: MapPoi) => {
    const layer = markersLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    const cat = poi.category ?? "poi";
    // Use the category-specific SVG icon for known categories, plain pin for others.
    const icon = CATEGORY_SYMBOLS[cat] ? categoryIcon(cat) : pinIcon(CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.poi);
    const m = new Marker(latLng(poi.lat, poi.lon), { icon });
    m.bindPopup(
      `<div style="font-size:13px;max-width:200px"><strong>${escapeHtml(poi.name)}</strong>${
        poi.description ? `<div style="color:#666;margin-top:2px">${escapeHtml(poi.description)}</div>` : ""
      }${poi.category ? `<div style="margin-top:4px;font-size:11px;text-transform:uppercase;color:#888">${escapeHtml(poi.category)}</div>` : ""}</div>`
    );
    m.on("click", () => setSelectedPoi(poi));
    m.addTo(layer);
  }, []);

  const drawRoute = useCallback(
    (geometry: [number, number][], waypoints: MapWaypoint[], pois: MapPoi[], type?: string) => {
      const layer = routeLayerRef.current;
      const map = mapRef.current;
      if (!layer || !map || geometry.length < 2) return;
      layer.clearLayers();
      const line = new Polyline(geometry.map(([lat, lon]) => latLng(lat, lon)), {
        color: CATEGORY_COLORS.route,
        weight: 4,
        opacity: 0.85,
      });
      line.addTo(layer);
      // Waypoint markers
      for (const wp of waypoints) {
        const m = new Marker(latLng(wp.lat, wp.lon), { icon: pinIcon(CATEGORY_COLORS.waypoint) });
        m.bindPopup(`<strong>${escapeHtml(wp.name)}</strong>`);
        m.addTo(layer);
      }
      // POI markers on the route layer
      const poiLayer = markersLayerRef.current;
      if (poiLayer) poiLayer.clearLayers();
      for (const p of pois) addMarker(p);
      // Fit bounds to the route
      try {
        const bounds = latLngBounds(geometry.map(([lat, lon]) => latLng(lat, lon)));
        map.fitBounds(bounds, { padding: [40, 40] });
      } catch {
        /* ignore */
      }
      currentRouteRef.current = { geometry, pois, waypoints, type };
    },
    [addMarker]
  );

  /** Full day data for drawTour — includes POIs, waypoints, and overnight
   *  spots so the map can render colorful category markers alongside the
   *  route polylines. */
  interface TourDayDraw {
    name: string;
    geometry: [number, number][];
    waypoints?: { name: string; lat: number; lon: number; type?: string }[];
    pois?: { name: string; lat: number; lon: number; category: string; description?: string }[];
    overnight?: { name: string; lat: number; lon: number; description?: string };
    wildCamp?: boolean;
  }

  /** Draw all days of a multi-day tour as overlaid polylines (each in a
   *  distinct color) AND render all POIs as colorful category markers
   *  (water=blue drop, sleeping=purple bed, landmarks=amber star,
   *  amenities=green fork, overnight=purple tent, wildcamp=red camp).
   *  Clears any previous route + markers first. */
  const drawTour = useCallback(
    (days: TourDayDraw[]) => {
      const layer = routeLayerRef.current;
      const map = mapRef.current;
      const poiLayer = markersLayerRef.current;
      if (!layer || !map) return;
      layer.clearLayers();
      poiLayer?.clearLayers();
      const colors = [
        "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6",
        "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
        "#06b6d4", "#a855f7", "#eab308", "#22c55e",
      ];
      const allPoints: [number, number][] = [];
      // Dedupe POIs by name+coords across days (a POI near a day boundary
      // may appear in two days).
      const seenPois = new Set<string>();
      days.forEach((d, i) => {
        if (d.geometry.length < 2) return;
        const color = colors[i % colors.length];
        const line = new Polyline(d.geometry.map(([lat, lon]) => latLng(lat, lon)), {
          color,
          weight: 4,
          opacity: 0.85,
        });
        line.bindPopup(`<strong>Day ${i + 1}: ${escapeHtml(d.name)}</strong>`);
        line.addTo(layer);
        allPoints.push(...d.geometry);

        // Start/end waypoint markers for this day (use the day's color)
        if (d.waypoints) {
          for (const wp of d.waypoints) {
            if (wp.type === "start" || wp.type === "end") {
              const wm = new Marker(latLng(wp.lat, wp.lon), { icon: pinIcon(color) });
              wm.bindPopup(`<strong>${escapeHtml(wp.name)}</strong><br><span style="font-size:11px;color:#888">Day ${i + 1} · ${wp.type}</span>`);
              wm.addTo(layer);
            }
          }
        }

        // POI markers (water, sleeping, landmarks, amenities) — colorful category icons
        if (d.pois && poiLayer) {
          for (const p of d.pois) {
            const key = `${p.name}|${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
            if (seenPois.has(key)) continue;
            seenPois.add(key);
            addMarker({ name: p.name, lat: p.lat, lon: p.lon, category: p.category, description: p.description });
          }
        }

        // Overnight marker — tent icon (purple for hut, red for wild camp)
        if (d.overnight && poiLayer) {
          const oKey = `overnight|${d.overnight.name}|${d.overnight.lat.toFixed(5)},${d.overnight.lon.toFixed(5)}`;
          if (!seenPois.has(oKey)) {
            seenPois.add(oKey);
            const cat = d.wildCamp ? "wildcamp" : "overnight";
            addMarker({
              name: d.wildCamp ? `${d.overnight.name} (wild camp)` : d.overnight.name,
              lat: d.overnight.lat,
              lon: d.overnight.lon,
              category: cat,
              description: d.overnight.description ?? (d.wildCamp ? "No hut/shelter found — wild camping" : "Overnight stop"),
            });
          }
        }
      });
      if (allPoints.length > 0) {
        try {
          const bounds = latLngBounds(allPoints.map(([lat, lon]) => latLng(lat, lon)));
          map.fitBounds(bounds, { padding: [40, 40] });
        } catch {
          /* ignore */
        }
      }
    },
    [addMarker]
  );

  // ===== Consume pending commands from Athena (via the maps store) =====
  useEffect(() => {
    const cmd = pendingCommand;
    const map = mapRef.current;
    if (!cmd || !map) return;
    (async () => {
      switch (cmd.kind) {
        case "show": {
          if (cmd.lat !== undefined && cmd.lon !== undefined) {
            map.setView(latLng(cmd.lat, cmd.lon), cmd.zoom ?? 13);
            if (cmd.label) {
              addMarker({ name: cmd.label, lat: cmd.lat, lon: cmd.lon, category: "poi" });
            }
          }
          break;
        }
        case "add_marker": {
          if (cmd.lat !== undefined && cmd.lon !== undefined && cmd.title) {
            addMarker({
              name: cmd.title,
              lat: cmd.lat,
              lon: cmd.lon,
              category: cmd.category,
              description: cmd.description,
            });
            map.setView(latLng(cmd.lat, cmd.lon), Math.max(map.getZoom(), 13));
          }
          break;
        }
        case "draw_route": {
          if (cmd.geometry && cmd.geometry.length >= 2) {
            drawRoute(cmd.geometry, cmd.waypoints ?? [], cmd.pois ?? [], cmd.type);
            if (cmd.distanceM !== undefined && cmd.durationS !== undefined) {
              setRouteInfo({
                distanceM: cmd.distanceM,
                durationS: cmd.durationS,
                ascentM: 0,
                descentM: 0,
              });
            }
          }
          break;
        }
        case "show_pois": {
          if (cmd.pois) {
            markersLayerRef.current?.clearLayers();
            for (const p of cmd.pois) addMarker(p);
            if (cmd.pois.length > 0) {
              const bounds = latLngBounds(cmd.pois.map((p) => latLng(p.lat, p.lon)));
              map.fitBounds(bounds, { padding: [40, 40] });
            }
          }
          break;
        }
        case "open_trip": {
          if (cmd.tripId) {
            try {
              const { trip } = await mapyApi.getTrip(cmd.tripId);
              drawRoute(trip.geometry, trip.waypoints, trip.pois, trip.type);
              setRouteInfo({
                distanceM: trip.distanceM,
                durationS: trip.durationS,
                ascentM: trip.ascentM,
                descentM: trip.descentM,
              });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to load trip");
            }
          }
          break;
        }
        case "draw_tour": {
          if (cmd.tourDays && cmd.tourDays.length > 0) {
            drawTour(cmd.tourDays.map((d) => ({
              name: d.name,
              geometry: d.geometry,
              waypoints: d.waypoints,
              pois: d.pois,
              overnight: d.overnight,
              wildCamp: d.wildCamp,
            })));
            setRouteInfo(null);
          }
          break;
        }
        case "open_tour": {
          if (cmd.tourId) {
            try {
              const { tourApi } = await import("../../services/maps");
              const detail = await tourApi.get(cmd.tourId);
              drawTour(detail.days.map((d) => ({
                name: d.name,
                geometry: d.geometry,
                waypoints: d.waypoints,
                pois: d.pois,
              })));
              setRouteInfo(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to load tour");
            }
          }
          break;
        }
        case "clear": {
          clearLayers();
          setRouteInfo(null);
          currentRouteRef.current = null;
          break;
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand?.seq]);

  // ===== Sidebar actions =====
  const doSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const { items } = await mapyApi.geocode(searchQuery, 10);
      setSearchResults(items);
      if (items.length > 0) {
        const first = items[0];
        mapRef.current?.setView(latLng(first.lat, first.lon), 13);
        addMarker({ name: first.name, lat: first.lat, lon: first.lon, category: "poi", description: first.location });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const resolvePlace = async (name: string): Promise<GeocodeItem | null> => {
    if (!name.trim()) return null;
    // If it looks like "lat,lon" coords, parse directly.
    const m = name.trim().match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (m) return { lat: Number(m[1]), lon: Number(m[2]), name, label: "coords", type: "coordinate", location: "" };
    const { items } = await mapyApi.geocode(name, 1);
    return items[0] ?? null;
  };

  const planRoute = async () => {
    // Resolve all stops. Need at least start + end (first + last).
    const filled = stops.map((s) => s.trim()).filter((s) => s.length > 0);
    if (filled.length < 2) {
      setError("Add at least a start and an end stop.");
      return;
    }
    setPlanning(true);
    setError(null);
    try {
      const resolved = await Promise.all(filled.map(resolvePlace));
      if (resolved.some((r) => !r)) {
        setError("Could not resolve one of the stops. Try a more specific name or use lat,lon.");
        return;
      }
      const pts = resolved as { lat: number; lon: number; name: string }[];
      const start = pts[0];
      const end = pts[pts.length - 1];
      const via = pts.slice(1, -1); // intermediate waypoints
      const result = await mapyApi.route({
        startLat: start.lat,
        startLon: start.lon,
        endLat: end.lat,
        endLon: end.lon,
        mode: routeMode,
        // The server route() expects waypoints as [lon, lat] pairs.
        ...(via.length > 0 ? { waypoints: via.map((p) => [p.lon, p.lat] as [number, number]) } : {}),
      });
      const waypoints = pts.map((p, i) => ({
        name: p.name,
        lat: p.lat,
        lon: p.lon,
        type: i === 0 ? "start" : i === pts.length - 1 ? "end" : "via",
      }));
      drawRoute(result.geometry, waypoints, [], routeMode);
      setRouteInfo({
        distanceM: result.distanceM,
        durationS: result.durationS,
        ascentM: result.ascentM,
        descentM: result.descentM,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Route planning failed");
    } finally {
      setPlanning(false);
    }
  };

  const findNearby = async (categories: "water" | "sleeping" | "landmarks" | "amenities" | "all") => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    setFindingNearby(true);
    setError(null);
    try {
      const { items } = await mapyApi.findNearby({
        lat: c.lat,
        lon: c.lng,
        radius: 5000,
        categories,
        limit: 30,
      });
      markersLayerRef.current?.clearLayers();
      for (const p of items) {
        addMarker({ name: p.name, lat: p.lat, lon: p.lon, category: p.category, description: p.description });
      }
      if (items.length > 0) {
        const bounds = latLngBounds(items.map((p) => latLng(p.lat, p.lon)));
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nearby search failed");
    } finally {
      setFindingNearby(false);
    }
  };

  const loadTrips = async () => {
    setLoadingTrips(true);
    try {
      const { trips: list } = await mapyApi.listTrips();
      setTrips(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trips");
    } finally {
      setLoadingTrips(false);
    }
  };

  const openTrip = async (id: string) => {
    try {
      const { trip } = await mapyApi.getTrip(id);
      drawRoute(trip.geometry, trip.waypoints, trip.pois, trip.type);
      setRouteInfo({
        distanceM: trip.distanceM,
        durationS: trip.durationS,
        ascentM: trip.ascentM,
        descentM: trip.descentM,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trip");
    }
  };

  const saveCurrentRoute = async () => {
    const cur = currentRouteRef.current;
    if (!cur || cur.geometry.length < 2) {
      setError("No route to save. Plan a route first.");
      return;
    }
    const name = await promptDialog("Trip name:", `Trip ${new Date().toLocaleDateString()}`);
    if (!name) return;
    try {
      await mapyApi.saveTrip({
        name,
        type: (cur.type as "hiking" | "bicycle" | "car") ?? "hiking",
        distanceM: routeInfo?.distanceM ?? 0,
        durationS: routeInfo?.durationS ?? 0,
        ascentM: routeInfo?.ascentM,
        descentM: routeInfo?.descentM,
        geometry: cur.geometry,
        waypoints: cur.waypoints,
        pois: cur.pois.map((p) => ({
          name: p.name,
          lat: p.lat,
          lon: p.lon,
          category: p.category ?? "poi",
          ...(p.description ? { description: p.description } : {}),
        })),
      });
      loadTrips();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save trip");
    }
  };

  const deleteTrip = async (id: string) => {
    if (!(await confirmDialog("Delete this trip?", { danger: true, confirmLabel: "Delete" }))) return;
    try {
      await mapyApi.deleteTrip(id);
      setTrips((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete trip");
    }
  };

  // ===== Render =====

  if (loadingKey) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-ink-muted">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
        <MapIcon className="text-ink-muted" size={40} />
        <h2 className="text-lg font-semibold text-ink">Mapy.cz API key required</h2>
        <p className="max-w-sm text-sm text-ink-muted">
          Add your mapy.com developer API key in <strong>Settings → Integrations</strong> to use the Maps app.
          Get a free key at{" "}
          <a href="https://developer.mapy.com/" target="_blank" rel="noreferrer" className="underline">
            developer.mapy.com
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-surface">
      {/* Map container */}
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0 z-0" />

        {/* Layer switcher (top-right) */}
        <div className="absolute right-2 top-2 z-[1000] flex gap-1 rounded-md border border-edge bg-surface-2/95 p-1 text-xs shadow">
          {(["outdoor", "basic", "aerial", "winter"] as Mapset[]).map((ms) => (
            <button
              key={ms}
              onClick={() => setMapset(ms)}
              className={`rounded px-2 py-1 capitalize transition-colors ${
                mapset === ms ? "bg-accent text-white" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
              }`}
            >
              {ms}
            </button>
          ))}
        </div>

        {/* Sidebar toggle (when collapsed) */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-2 top-2 z-[1000] flex items-center gap-1.5 rounded-md border border-edge bg-surface-2/95 px-2 py-1.5 text-xs text-ink shadow hover:bg-surface-3"
          >
            <Search size={14} /> Panel
          </button>
        )}

        {/* POI info popup (bottom) */}
        {selectedPoi && (
          <div className="absolute bottom-2 left-2 z-[1000] max-w-xs rounded-md border border-edge bg-surface-2/95 p-3 text-sm shadow">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-ink">{selectedPoi.name}</div>
                {selectedPoi.description && <div className="mt-0.5 text-ink-muted">{selectedPoi.description}</div>}
                {selectedPoi.category && (
                  <div className="mt-1 text-[10px] uppercase text-ink-muted">{selectedPoi.category}</div>
                )}
              </div>
              <button onClick={() => setSelectedPoi(null)} className="text-ink-muted hover:text-ink">
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar */}
      {sidebarOpen && (
        <div className="flex w-72 shrink-0 flex-col border-l border-edge bg-surface-2 @container">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="text-sm font-semibold text-ink">Maps</span>
            <button onClick={() => setSidebarOpen(false)} className="text-ink-muted hover:text-ink">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-3">
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-xs text-red-500">
                {error}
                <button onClick={() => setError(null)} className="ml-1 underline">
                  dismiss
                </button>
              </div>
            )}

            {/* Search */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase text-ink-muted">
                <Search size={13} /> Search
              </h3>
              <div className="flex gap-1.5">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doSearch()}
                  placeholder="Place name or lat,lon"
                  className="min-w-0 flex-1 rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                />
                <button
                  onClick={doSearch}
                  disabled={searching}
                  className="rounded-md bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                </button>
              </div>
              {searchResults.length > 0 && (
                <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto">
                  {searchResults.map((r, i) => (
                    <li key={i}>
                      <button
                        onClick={() => {
                          mapRef.current?.setView(latLng(r.lat, r.lon), 13);
                          addMarker({ name: r.name, lat: r.lat, lon: r.lon, category: "poi", description: r.location });
                        }}
                        className="w-full truncate rounded px-1.5 py-1 text-left text-xs text-ink hover:bg-surface-3"
                        title={r.location}
                      >
                        {r.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Route planner / Tour planner tabs */}
            <section>
              <div className="mb-1.5 flex gap-1">
                <button
                  onClick={() => setSidebarTab("route")}
                  className={`flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-xs font-semibold uppercase transition-colors ${
                    sidebarTab === "route" ? "bg-accent text-white" : "bg-surface text-ink-muted hover:bg-surface-3"
                  }`}
                >
                  <Route size={12} /> Route
                </button>
                <button
                  onClick={() => setSidebarTab("tour")}
                  className={`flex flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 text-xs font-semibold uppercase transition-colors ${
                    sidebarTab === "tour" ? "bg-accent text-white" : "bg-surface text-ink-muted hover:bg-surface-3"
                  }`}
                >
                  <CalendarDays size={12} /> Tour
                </button>
              </div>

              {sidebarTab === "route" ? (
                <div className="space-y-1.5">
                  {/* Stops list (start, vias, end) */}
                  <div className="space-y-1">
                    {stops.map((stop, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="w-4 shrink-0 text-center text-[10px] text-ink-muted">
                          {i === 0 ? "A" : i === stops.length - 1 ? "B" : i}
                        </span>
                        <input
                          value={stop}
                          onChange={(e) => {
                            const next = [...stops];
                            next[i] = e.target.value;
                            setStops(next);
                          }}
                          placeholder={
                            i === 0
                              ? "Start (place or lat,lon)"
                              : i === stops.length - 1
                              ? "End (place or lat,lon)"
                              : `Via ${i} (place or lat,lon)`
                          }
                          className="min-w-0 flex-1 rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                        />
                        {stops.length > 2 && (
                          <button
                            onClick={() => setStops(stops.filter((_, idx) => idx !== i))}
                            className="shrink-0 text-ink-muted hover:text-red-500"
                            title="Remove stop"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setStops([...stops.slice(0, -1), "", stops[stops.length - 1]])}
                    className="flex w-full items-center justify-center gap-1 rounded bg-surface px-2 py-1 text-xs text-ink-muted hover:bg-surface-3"
                  >
                    <Plus size={12} /> Add via stop
                  </button>
                  {/* Click-to-add-stop toggle */}
                  <button
                    onClick={() => setAddStopOnClick((v) => !v)}
                    className={`flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                      addStopOnClick ? "bg-accent/20 text-accent" : "bg-surface text-ink-muted hover:bg-surface-3"
                    }`}
                    title="Click anywhere on the map to add a via stop"
                  >
                    <MapPin size={12} /> {addStopOnClick ? "Click map to add stop (on)" : "Click map to add stop"}
                  </button>
                  <div className="flex gap-1">
                    {(["hiking", "bicycle", "car"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setRouteMode(m)}
                        className={`flex-1 rounded px-1.5 py-1 text-xs capitalize transition-colors ${
                          routeMode === m ? "bg-accent text-white" : "bg-surface text-ink-muted hover:bg-surface-3"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={planRoute}
                    disabled={planning}
                    className="w-full rounded-md bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-50"
                  >
                    {planning ? <Loader2 size={13} className="mx-auto animate-spin" /> : "Plan route"}
                  </button>
                </div>
              ) : (
                <TourPlanner
                  resolvePlace={resolvePlace}
                  onDrawTour={drawTour}
                  onClearMap={clearLayers}
                />
              )}

              {sidebarTab === "route" && routeInfo && (
                <div className="mt-2 rounded-md border border-edge bg-surface p-2 text-xs text-ink">
                  <div className="flex justify-between"><span className="text-ink-muted">Distance</span><span>{fmtDistance(routeInfo.distanceM)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-muted">Duration</span><span>{fmtDuration(routeInfo.durationS)}</span></div>
                  {routeInfo.ascentM > 0 && (
                    <div className="flex justify-between"><span className="text-ink-muted">Ascent</span><span>{Math.round(routeInfo.ascentM)} m</span></div>
                  )}
                  {routeInfo.descentM > 0 && (
                    <div className="flex justify-between"><span className="text-ink-muted">Descent</span><span>{Math.round(routeInfo.descentM)} m</span></div>
                  )}
                  <button
                    onClick={saveCurrentRoute}
                    className="mt-2 flex w-full items-center justify-center gap-1 rounded bg-surface-3 px-2 py-1 text-xs text-ink hover:bg-surface"
                  >
                    <Save size={12} /> Save trip
                  </button>
                </div>
              )}
            </section>

            {/* Find nearby */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase text-ink-muted">
                <Plus size={13} /> Find nearby (map center)
              </h3>
              <div className="grid grid-cols-2 gap-1">
                <button onClick={() => findNearby("water")} disabled={findingNearby} className="flex items-center justify-center gap-1 rounded bg-surface px-1.5 py-1.5 text-xs text-ink hover:bg-surface-3 disabled:opacity-50">
                  <Droplets size={12} /> Water
                </button>
                <button onClick={() => findNearby("sleeping")} disabled={findingNearby} className="flex items-center justify-center gap-1 rounded bg-surface px-1.5 py-1.5 text-xs text-ink hover:bg-surface-3 disabled:opacity-50">
                  <BedDouble size={12} /> Sleep
                </button>
                <button onClick={() => findNearby("landmarks")} disabled={findingNearby} className="flex items-center justify-center gap-1 rounded bg-surface px-1.5 py-1.5 text-xs text-ink hover:bg-surface-3 disabled:opacity-50">
                  <Landmark size={12} /> Sights
                </button>
                <button onClick={() => findNearby("amenities")} disabled={findingNearby} className="flex items-center justify-center gap-1 rounded bg-surface px-1.5 py-1.5 text-xs text-ink hover:bg-surface-3 disabled:opacity-50">
                  <Utensils size={12} /> Food
                </button>
              </div>
              <button
                onClick={clearLayers}
                className="mt-1.5 w-full rounded bg-surface px-2 py-1.5 text-xs text-ink-muted hover:bg-surface-3"
              >
                Clear markers
              </button>
            </section>

            {/* Trips */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-ink-muted">
                  <FolderOpen size={13} /> Trips
                </h3>
                <button onClick={loadTrips} className="text-xs text-accent hover:underline">
                  {loadingTrips ? <Loader2 size={12} className="animate-spin" /> : "Refresh"}
                </button>
              </div>
              {trips.length === 0 ? (
                <p className="text-xs text-ink-muted">No saved trips. Plan a route and save it.</p>
              ) : (
                <ul className="space-y-1">
                  {trips.map((t) => (
                    <li key={t.id} className="flex items-center gap-1.5 rounded bg-surface px-2 py-1.5 text-xs">
                      <button onClick={() => openTrip(t.id)} className="min-w-0 flex-1 text-left text-ink hover:underline">
                        <div className="truncate">{t.name}</div>
                        <div className="text-[10px] text-ink-muted">
                          {t.type} · {fmtDistance(t.distanceM)} · {fmtDuration(t.durationS)}
                        </div>
                      </button>
                      <button onClick={() => deleteTrip(t.id)} className="text-ink-muted hover:text-red-500">
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
