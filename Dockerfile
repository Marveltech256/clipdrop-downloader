FROM node:24-bookworm-slim AS node
FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
COPY static ./static
ENV BIND_HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["python", "-u", "server.py"]
