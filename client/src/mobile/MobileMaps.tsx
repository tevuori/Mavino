import { useEffect, useRef, useState, useCallback } from "react";
import {
  Map as LeafletMap,
  TileLayer,
  Marker,
  Polyline,
  LayerGroup,
  Control,
  DivIcon,
  latLng,
  latLngBounds,
  type LatLng,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  ArrowLeft,
  Search,
  MapPin,
  Navigation,
  Route,
  Save,
  X,
  Loader2,
  FolderOpen,
  Clock,
  Ruler,
  TrendingUp,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  mapyApi,
  type GeocodeItem,
  type RouteResult,
  type TripSummary,
  type TripDetail,
  type TripInput,
} from "../services/maps";
import {
  MobileInput,
  MobileButton,
  MobileModal,
  MobileEmpty,
  MobileLoading,
  MobileDesktopNote,
} from "./MobileUi";
import type { MobileTool } from "./MobileLauncher";

const MAPY_ATTRIBUTION =
  '<a href="https://api.mapy.com/copyright" target="_blank">&copy; Seznam.cz a.s. a další</a>';

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

const CATEGORY_SYMBOLS: Record<string, string> = {
  water: '<path d="M12 2C12 2 6 10 6 14a6 6 0 0 0 12 0c0-4-6-12-6-12z" fill="white"/>',
  sleeping: '<path d="M3 7v10h2v-3h14v3h2V10c0-1.7-1.3-3-3-3H3zm2 2h12c.6 0 1 .4 1 1v2H5V9z" fill="white"/>',
  landmarks: '<path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6L12 2z" fill="white"/>',
  amenities: '<path d="M6 2v7c0 1.1.9 2 2 2v9h2V2H8v7H6V2zm10 0c-1.7 0-3 2.2-3 5s1.3 5 3 5v8h2V2h-2z" fill="white"/>',
  overnight: '<path d="M12 4L3 20h18L12 4zm0 4l5 9H7l5-9z" fill="white"/>',
  wildcamp: '<path d="M12 2c0 3-2 4-2 7 0 2 1 3 2 3s2-1 2-3c0-3-2-4-2-7zm-4 8c-1 2-2 3-2 5 0 3 3 5 6 5s6-2 6-5c0-2-1-3-2-5" fill="none" stroke="white" stroke-width="1.5"/>',
  poi: '<circle cx="12" cy="12" r="5" fill="white"/>',
};

function tileUrl(apiKey: string): string {
  return `https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=${encodeURIComponent(apiKey)}`;
}

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

function locationIcon(): DivIcon {
  return new DivIcon({
    className: "athena-map-pin",
    html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px #2563eb,0 1px 4px rgba(0,0,0,.4)"></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function MobileMaps({
  onClose,
}: {
  onClose: () => void;
  onOpenTool: (tool: MobileTool) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<TileLayer | null>(null);
  const markersLayerRef = useRef<LayerGroup | null>(null);
  const routeLayerRef = useRef<LayerGroup | null>(null);
  const locationMarkerRef = useRef<Marker | null>(null);
  const searchPinRef = useRef<Marker | null>(null);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedResult, setSelectedResult] = useState<GeocodeItem | null>(null);

  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const [tripsOpen, setTripsOpen] = useState(false);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);

  const [currentTrip, setCurrentTrip] = useState<TripDetail | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distanceM: number; durationS: number; ascentM: number } | null>(null);
  const [routing, setRouting] = useState(false);

  const [saveOpen, setSaveOpen] = useState(false);
  const [tripName, setTripName] = useState("");
  const [saving, setSaving] = useState(false);

  // Load credentials status + API key on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { configured: isConfigured } = await mapyApi.credentialsStatus();
        if (cancelled) return;
        setConfigured(isConfigured);
        if (!isConfigured) return;
        const { apiKey: key } = await mapyApi.getApiKey();
        if (!cancelled) setApiKey(key);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load map credentials");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize Leaflet once we have the API key and a container.
  useEffect(() => {
    if (!apiKey || !containerRef.current || mapRef.current) return;

    const map = new LeafletMap(containerRef.current, {
      center: latLng(49.8, 15.5),
      zoom: 8,
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    const layer = new TileLayer(tileUrl(apiKey), {
      minZoom: 0,
      maxZoom: 20,
      attribution: MAPY_ATTRIBUTION,
    });
    layer.addTo(map);
    layerRef.current = layer;

    markersLayerRef.current = new LayerGroup().addTo(map);
    routeLayerRef.current = new LayerGroup().addTo(map);

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
    new (LogoControl as unknown as new () => Control)().addTo(map);

    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markersLayerRef.current = null;
      routeLayerRef.current = null;
      locationMarkerRef.current = null;
      searchPinRef.current = null;
    };
  }, [apiKey]);

  const clearRoute = useCallback(() => {
    routeLayerRef.current?.clearLayers();
    setCurrentTrip(null);
    setRouteInfo(null);
  }, []);

  // Debounced geocode search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const { items } = await mapyApi.geocode(q, 8);
        setResults(items);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  const flyToResult = useCallback((item: GeocodeItem) => {
    const map = mapRef.current;
    if (!map) return;
    setQuery(item.name);
    setResults([]);
    setSelectedResult(item);
    map.flyTo(latLng(item.lat, item.lon), 15, { duration: 0.6 });
    if (searchPinRef.current) searchPinRef.current.remove();
    const marker = new Marker(latLng(item.lat, item.lon), { icon: pinIcon(CATEGORY_COLORS.route) });
    marker.bindPopup(`<strong>${escapeHtml(item.name)}</strong>`);
    marker.addTo(map);
    searchPinRef.current = marker;
  }, []);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        setCurrentLocation({ lat, lon });
        const map = mapRef.current;
        if (!map) {
          setLocating(false);
          return;
        }
        if (locationMarkerRef.current) locationMarkerRef.current.remove();
        const marker = new Marker(latLng(lat, lon), { icon: locationIcon() });
        marker.bindPopup("<strong>You are here</strong>");
        marker.addTo(map);
        locationMarkerRef.current = marker;
        map.flyTo(latLng(lat, lon), 14, { duration: 0.6 });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError("Unable to retrieve your location.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const drawTripOnMap = useCallback((trip: TripDetail) => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !routeLayer || !markersLayer) return;

    routeLayer.clearLayers();
    markersLayer.clearLayers();

    if (trip.geometry.length >= 2) {
      const line = new Polyline(trip.geometry.map(([lt, ln]) => latLng(lt, ln)), {
        color: CATEGORY_COLORS.route,
        weight: 4,
        opacity: 0.85,
      });
      line.addTo(routeLayer);
    }

    for (const wp of trip.waypoints) {
      const m = new Marker(latLng(wp.lat, wp.lon), { icon: pinIcon(CATEGORY_COLORS.waypoint) });
      m.bindPopup(`<strong>${escapeHtml(wp.name)}</strong>`);
      m.addTo(routeLayer);
    }

    for (const p of trip.pois) {
      const m = new Marker(latLng(p.lat, p.lon), { icon: categoryIcon(p.category) });
      m.bindPopup(
        `<div style="font-size:13px;max-width:200px"><strong>${escapeHtml(p.name)}</strong>${
          p.description ? `<div style="color:#666;margin-top:2px">${escapeHtml(p.description)}</div>` : ""
        }${`<div style="margin-top:4px;font-size:11px;text-transform:uppercase;color:#888">${escapeHtml(p.category)}</div>`}</div>`
      );
      m.addTo(routeLayer);
    }

    if (trip.geometry.length > 0) {
      try {
        const bounds = latLngBounds(trip.geometry.map(([lt, ln]) => latLng(lt, ln)));
        map.fitBounds(bounds, { padding: [30, 30] });
      } catch {
        /* ignore */
      }
    }

    setCurrentTrip(trip);
    setRouteInfo({ distanceM: trip.distanceM, durationS: trip.durationS, ascentM: trip.ascentM });
  }, []);

  const loadTrips = useCallback(async () => {
    setLoadingTrips(true);
    try {
      const { trips: list } = await mapyApi.listTrips();
      setTrips(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trips");
    } finally {
      setLoadingTrips(false);
    }
  }, []);

  const openTrip = useCallback(async (id: string) => {
    try {
      const { trip } = await mapyApi.getTrip(id);
      drawTripOnMap(trip);
      setTripsOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trip");
    }
  }, [drawTripOnMap]);

  const routeFromHere = useCallback(async () => {
    if (!currentLocation || !selectedResult) return;
    setRouting(true);
    clearRoute();
    try {
      const result: RouteResult = await mapyApi.route({
        startLat: currentLocation.lat,
        startLon: currentLocation.lon,
        endLat: selectedResult.lat,
        endLon: selectedResult.lon,
        mode: "hiking",
      });
      const map = mapRef.current;
      const routeLayer = routeLayerRef.current;
      if (!map || !routeLayer) return;

      const line = new Polyline(result.geometry.map(([lt, ln]) => latLng(lt, ln)), {
        color: CATEGORY_COLORS.route,
        weight: 4,
        opacity: 0.85,
      });
      line.addTo(routeLayer);

      try {
        const bounds = latLngBounds(result.geometry.map(([lt, ln]) => latLng(lt, ln)));
        map.fitBounds(bounds, { padding: [30, 30] });
      } catch {
        /* ignore */
      }

      setRouteInfo({ distanceM: result.distanceM, durationS: result.durationS, ascentM: result.ascentM });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Routing failed");
    } finally {
      setRouting(false);
    }
  }, [currentLocation, selectedResult, clearRoute]);

  const saveRoute = useCallback(async () => {
    if (!routeInfo || !currentLocation || !selectedResult) return;
    setSaving(true);
    try {
      const geometry: [number, number][] = routeLayerRef.current
        ?.getLayers()
        .filter((l): l is Polyline => l instanceof Polyline)
        .flatMap((l) => {
          const pts = l.getLatLngs() as LatLng[];
          return pts.map((pt) => [pt.lat, pt.lng] as [number, number]);
        }) ?? [];

      const input: TripInput = {
        name: tripName.trim() || "Hiking route",
        type: "hiking",
        distanceM: routeInfo.distanceM,
        durationS: routeInfo.durationS,
        ascentM: routeInfo.ascentM,
        geometry,
        waypoints: [
          { name: "Start", lat: currentLocation.lat, lon: currentLocation.lon, type: "start" },
          { name: selectedResult.name, lat: selectedResult.lat, lon: selectedResult.lon, type: "end" },
        ],
      };
      await mapyApi.saveTrip(input);
      setSaveOpen(false);
      setTripName("");
      await loadTrips();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save trip");
    } finally {
      setSaving(false);
    }
  }, [routeInfo, currentLocation, selectedResult, tripName, loadTrips]);

  // Re-calculate map size whenever the bottom sheet opens/closes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = setTimeout(() => map.invalidateSize(), 220);
    return () => clearTimeout(id);
  }, [tripsOpen]);

  if (configured === false) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="max-w-xs rounded-2xl border border-edge bg-surface-2 p-5">
          <MapPin size={32} className="mx-auto mb-3 text-accent" />
          <h1 className="mb-2 text-lg font-semibold text-ink">Maps not configured</h1>
          <MobileDesktopNote text="Add your mapy.com API key in Settings → Integrations on desktop first." />
          <MobileButton variant="ghost" onClick={onClose} className="mt-2 w-full">
            Go back
          </MobileButton>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Floating back button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-[1000] flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink shadow-lg active:bg-surface-3"
        aria-label="Back"
      >
        <ArrowLeft size={21} />
      </button>

      {/* Search bar */}
      <div className="absolute right-4 left-16 top-[max(1rem,env(safe-area-inset-top))] z-[1000]">
        <div className="relative">
          <div className="flex items-center gap-2 rounded-2xl border border-edge bg-surface/95 px-3 py-2 shadow-lg backdrop-blur">
            <Search size={18} className="shrink-0 text-ink-muted" />
            <MobileInput
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedResult(null);
              }}
              placeholder="Search places"
              className="border-0 bg-transparent px-0 py-0 shadow-none focus:border-0"
            />
            {searching && <Loader2 size={18} className="animate-spin text-ink-muted" />}
          </div>
          {results.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-2 max-h-72 overflow-y-auto rounded-2xl border border-edge bg-surface p-2 shadow-xl">
              {results.map((item) => (
                <button
                  key={`${item.lat}-${item.lon}-${item.name}`}
                  type="button"
                  onClick={() => flyToResult(item)}
                  className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition active:bg-surface-3"
                >
                  <MapPin size={16} className="mt-0.5 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                    <p className="text-xs text-ink-muted">{item.label}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedResult && currentLocation && (
          <div className="mt-2 flex items-center gap-2 rounded-2xl border border-edge bg-surface/95 p-2 shadow-lg backdrop-blur">
            <div className="min-w-0 flex-1 px-1">
              <p className="truncate text-xs text-ink-muted">{selectedResult.name}</p>
            </div>
            <MobileButton onClick={routeFromHere} disabled={routing} className="shrink-0 text-xs">
              {routing ? <Loader2 size={14} className="animate-spin" /> : <Route size={14} />}
              Route from here
            </MobileButton>
          </div>
        )}
      </div>

      {/* Locate me button */}
      <button
        type="button"
        onClick={locateMe}
        disabled={locating}
        className="absolute right-4 top-[calc(max(1rem,env(safe-area-inset-top))+4rem)] z-[1000] flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink shadow-lg active:bg-surface-3 disabled:opacity-50"
        aria-label="Locate me"
      >
        {locating ? <Loader2 size={20} className="animate-spin" /> : <Navigation size={20} />}
      </button>

      {/* Map container */}
      <div ref={containerRef} className="relative flex-1 bg-surface-3" />

      {/* Stats strip */}
      {routeInfo && (
        <div className="absolute left-4 right-4 top-[calc(max(1rem,env(safe-area-inset-top))+8rem)] z-[1000] rounded-2xl border border-edge bg-surface/95 p-3 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <Ruler size={14} className="text-accent" />
                <span className="font-medium text-ink">{fmtDistance(routeInfo.distanceM)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <Clock size={14} className="text-accent" />
                <span className="font-medium text-ink">{fmtDuration(routeInfo.durationS)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                <TrendingUp size={14} className="text-accent" />
                <span className="font-medium text-ink">{Math.round(routeInfo.ascentM)} m</span>
              </div>
            </div>
            {!currentTrip && (
              <MobileButton onClick={() => setSaveOpen(true)} disabled={routing} variant="ghost" className="px-2 py-1.5 text-xs">
                <Save size={14} />
                Save
              </MobileButton>
            )}
          </div>
        </div>
      )}

      {/* Saved trips bottom sheet */}
      <div
        className={`absolute bottom-4 left-4 right-4 z-[1000] rounded-2xl border border-edge bg-surface/95 shadow-2xl backdrop-blur transition-all ${
          tripsOpen ? "max-h-[60vh]" : "max-h-14"
        } overflow-hidden`}
      >
        <button
          type="button"
          onClick={() => {
            setTripsOpen((v) => !v);
            if (!tripsOpen) void loadTrips();
          }}
          className="flex w-full items-center justify-between px-4 py-3.5"
        >
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-accent" />
            <span className="text-sm font-semibold text-ink">Saved trips</span>
          </div>
          {tripsOpen ? <ChevronDown size={20} className="text-ink-muted" /> : <ChevronUp size={20} className="text-ink-muted" />}
        </button>
        <div className="space-y-2 overflow-y-auto px-3 pb-3">
          <MobileDesktopNote text="Multi-day hiking tour planning with AI narration is available in the Maps app on desktop." />
          {loadingTrips ? (
            <MobileLoading count={2} />
          ) : trips.length === 0 ? (
            <MobileEmpty text="No saved trips yet. Plan and save one from the desktop Maps app, or route here and save." />
          ) : (
            trips.map((trip) => (
              <button
                key={trip.id}
                type="button"
                onClick={() => void openTrip(trip.id)}
                className="flex w-full items-center justify-between rounded-xl border border-edge bg-surface-2 p-3 text-left transition active:bg-surface-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{trip.name}</p>
                  <p className="text-xs text-ink-muted">
                    {fmtDistance(trip.distanceM)} · {fmtDuration(trip.durationS)} · ↑{Math.round(trip.ascentM)} m
                  </p>
                </div>
                <Route size={16} className="shrink-0 text-ink-muted" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="absolute bottom-20 left-4 right-4 z-[1001] flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <X size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="shrink-0">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Save trip modal */}
      <MobileModal
        open={saveOpen}
        onClose={() => { setSaveOpen(false); setTripName(""); }}
        title="Save trip"
        footer={
          <>
            <MobileButton variant="ghost" onClick={() => { setSaveOpen(false); setTripName(""); }}>
              Cancel
            </MobileButton>
            <MobileButton onClick={() => void saveRoute()} disabled={saving || !tripName.trim()}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save
            </MobileButton>
          </>
        }
      >
        <MobileInput
          value={tripName}
          onChange={(e) => setTripName(e.target.value)}
          placeholder="Trip name"
        />
      </MobileModal>
    </div>
  );
}
