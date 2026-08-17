FROM nginx:stable-alpine

# nginx.conf uses ${CERT_DOMAIN} and the limit_req_zone directive; copy it into
# the conf.d directory so it is loaded as the default server block.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The base image ships a default.conf that would conflict — remove it.
RUN rm -f /etc/nginx/conf.d/default.conf.bak
