# The simulated industrial PC image: the canbus sidecar, every ECU, the controller and the gateway, picked by GW_ROLE.
# build from the repo root: docker build -f edge/Dockerfile -t groundwork-ipc:local .
FROM python:3.12-slim AS proto
RUN pip install --no-cache-dir grpcio-tools==1.71.0
COPY edge/ipc/proto/sparkplug_b.proto /proto/sparkplug_b.proto
RUN python -m grpc_tools.protoc -I/proto --python_out=/proto /proto/sparkplug_b.proto

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app:/app/twin_lib
WORKDIR /app
COPY edge/requirements.txt edge/requirements.txt
RUN pip install --no-cache-dir -r edge/requirements.txt
COPY edge/ipc ipc
COPY edge/tools tools
COPY edge/canbus canbus
COPY edge/dbc dbc
COPY --from=proto /proto/sparkplug_b_pb2.py ipc/proto/sparkplug_b_pb2.py
# the twin's own J1939 encoder and site layout, so a PC's frames match the twin's byte for byte
COPY abenix/code-assets/gw-site-twin/twin/j1939.py abenix/code-assets/gw-site-twin/twin/layout.py twin_lib/twin/
RUN touch twin_lib/twin/__init__.py ipc/proto/__init__.py \
 && printf '#!/bin/sh\nexec python -m canbus.candump "$@"\n' > /usr/local/bin/candump && chmod 755 /usr/local/bin/candump \
 && useradd --uid 10001 --no-create-home gw && mkdir -p /plant /var/log/candump && chown -R gw /app /plant /var/log/candump
USER 10001
CMD ["python", "-m", "ipc"]
