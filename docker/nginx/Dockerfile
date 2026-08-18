FROM nginx:stable-alpine

# Ship nginx.conf as a TEMPLATE. The official nginx image runs envsubst on
# /etc/nginx/templates/*.template at startup, substituting container env vars
# (here ${CERT_DOMAIN}) and emitting the result to /etc/nginx/conf.d/. This is
# what makes the ${CERT_DOMAIN} cert paths in nginx.conf resolve at runtime —
# nginx itself does not do shell variable substitution.
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Drop the stock default server block so only ours is loaded.
RUN rm -f /etc/nginx/conf.d/default.conf
