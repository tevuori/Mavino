FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY scripts/copy-pdf-worker.js ./scripts/
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Production nginx config: SPA + /api reverse proxy to the server container.
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
