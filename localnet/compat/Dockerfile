ARG BASE_IMAGE=yeagerai/simulator-jsonrpc:v0.121.6
FROM ${BASE_IMAGE}
ARG APP_USER=backend-user
USER root
COPY patch_finalized_reads.py test_finalized_reads.py /tmp/bevor-compat/
RUN python3 /tmp/bevor-compat/patch_finalized_reads.py && python3 /tmp/bevor-compat/test_finalized_reads.py
USER ${APP_USER}
