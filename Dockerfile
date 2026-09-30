# Vite 在构建时写入 API 基础路径，因此通过构建参数固定为同源反向代理地址。
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
RUN set -eu; \
    for attempt in 1 2 3 4 5; do \
      if npm ci --registry "$NPM_CONFIG_REGISTRY"; then exit 0; fi; \
      echo "npm dependency installation failed (attempt ${attempt}/5)" >&2; \
      sleep $((attempt * 2)); \
    done; \
    exit 1

COPY . ./

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_LOGIN_SUCCESS_URL=/
ARG VITE_CONTRACT_PUBLIC_PATH_PREFIX=/contract_management
ARG VITE_CONTRACT_API_BASE_URL=/contract_management/api/v1
ARG VITE_PROJECT_PUBLIC_PATH_PREFIX=/project_management
ARG VITE_PROJECT_API_BASE_URL=/project_management/api/v1
ARG VITE_CRM_PUBLIC_PATH_PREFIX=/customer-opportunity
ARG VITE_CRM_API_BASE_URL=/customer-opportunity/api/v1
ARG VITE_CUSTOMER_PORTAL_PUBLIC_PATH_PREFIX=/customer-portal
ARG VITE_CUSTOMER_PORTAL_API_BASE_URL=/customer-portal/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_LOGIN_SUCCESS_URL=${VITE_LOGIN_SUCCESS_URL}
ENV VITE_CONTRACT_PUBLIC_PATH_PREFIX=${VITE_CONTRACT_PUBLIC_PATH_PREFIX}
ENV VITE_CONTRACT_API_BASE_URL=${VITE_CONTRACT_API_BASE_URL}
ENV VITE_PROJECT_PUBLIC_PATH_PREFIX=${VITE_PROJECT_PUBLIC_PATH_PREFIX}
ENV VITE_PROJECT_API_BASE_URL=${VITE_PROJECT_API_BASE_URL}
ENV VITE_CRM_PUBLIC_PATH_PREFIX=${VITE_CRM_PUBLIC_PATH_PREFIX}
ENV VITE_CRM_API_BASE_URL=${VITE_CRM_API_BASE_URL}
ENV VITE_CUSTOMER_PORTAL_PUBLIC_PATH_PREFIX=${VITE_CUSTOMER_PORTAL_PUBLIC_PATH_PREFIX}
ENV VITE_CUSTOMER_PORTAL_API_BASE_URL=${VITE_CUSTOMER_PORTAL_API_BASE_URL}

# 离线前端包生成前先执行回归：包括生产接入页对已退役历史环境的过滤。
# 测试失败时不得继续生成可交付镜像。
RUN npm test \
    && npm run build

# 前端静态资源由 Nginx 提供，并将 API、OIDC 端点代理至后端 API 容器。
FROM nginx:1.27-alpine

RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/templates /etc/nginx/gateway-templates

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/gateway-http.conf.template /etc/nginx/gateway-templates/gateway-http.conf.template
COPY nginx/gateway-https.conf.template /etc/nginx/gateway-templates/gateway-https.conf.template
COPY nginx/gateway-draining.conf.template /etc/nginx/gateway-templates/gateway-draining.conf.template
COPY nginx/05-select-public-transport.sh /docker-entrypoint.d/05-select-public-transport.sh
RUN chmod 0755 /docker-entrypoint.d/05-select-public-transport.sh
RUN mkdir -p /etc/nginx/portal-apps.d
COPY nginx/portal-apps-locations.conf /etc/nginx/portal-apps.d/managed.conf
COPY --from=builder /app/dist /usr/share/nginx/html
RUN find /usr/share/nginx/html -type d -exec chmod 0755 {} + \
    && find /usr/share/nginx/html -type f -exec chmod 0644 {} +

EXPOSE 80 443
