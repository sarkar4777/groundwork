# build from the repo root: docker build -f bff/Dockerfile -t groundwork-bff:local .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY bff/requirements.txt bff/requirements.txt
RUN pip install --no-cache-dir -r bff/requirements.txt
COPY bff/gwbff bff/gwbff
COPY bff/vendor bff/vendor
COPY bff/story_cache bff/story_cache
COPY abenix/specs abenix/specs
RUN useradd --uid 10001 --no-create-home gw && chown -R gw /app
USER 10001
WORKDIR /app/bff
EXPOSE 8710
CMD ["python", "-m", "uvicorn", "gwbff.app:app", "--host", "0.0.0.0", "--port", "8710", "--log-level", "warning"]
