# Self-hosted product search embedder: text-embeddings-inference on CPU with intfloat/multilingual-e5-small baked in.
#
# Fargate has no persistent volume, so the model is fetched once at build time and never when a task starts. The
# cache written to /data has the layout TEI reads from the Hugging Face hub cache: refs/main names the commit, and
# snapshots/<commit> holds the files. With HF_HUB_OFFLINE=1 TEI never reaches the network.
#
# Build:  docker build -t pharmacy-central/embedder deploy/embedder
# Run:    the entrypoint and flags are TEI's, e.g.
#         --model-id intfloat/multilingual-e5-small --api-key <key>

ARG TEI_IMAGE=ghcr.io/huggingface/text-embeddings-inference:cpu-1.9@sha256:2538ea1c9640d3763b15af668039d24172d063b42337b0c27796fc2be180c78d
ARG MODEL_ID=intfloat/multilingual-e5-small
# Commit of the model repository on the Hub. Changing it changes the model, so bump it on purpose and rebuild.
ARG MODEL_REVISION=614241f622f53c4eeff9890bdc4f31cfecc418b3

# The fetch stage reuses the pinned TEI image, which already ships curl and a POSIX shell, so no second base image
# is pulled. Only /out is copied into the final image.
FROM ${TEI_IMAGE} AS model
ARG MODEL_ID
ARG MODEL_REVISION
# These are the files TEI requests while it loads this model (its download log), plus modules.json, which the
# sentence-transformers layout ships. The ONNX weights are the model TEI runs.
RUN set -eux; \
    org="${MODEL_ID%%/*}"; \
    name="${MODEL_ID#*/}"; \
    cache="/out/models--${org}--${name}"; \
    snapshot="${cache}/snapshots/${MODEL_REVISION}"; \
    mkdir -p "${cache}/refs" "${snapshot}/1_Pooling" "${snapshot}/onnx"; \
    printf '%s' "${MODEL_REVISION}" > "${cache}/refs/main"; \
    for file in \
        config.json \
        modules.json \
        sentence_bert_config.json \
        1_Pooling/config.json \
        tokenizer.json \
        tokenizer_config.json \
        onnx/model.onnx; do \
      curl -fsSL --retry 5 -o "${snapshot}/${file}" \
        "https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}"; \
    done

FROM ${TEI_IMAGE}
ARG MODEL_ID
ARG MODEL_REVISION
COPY --from=model /out/ /data/
# TEI already sets HUGGINGFACE_HUB_CACHE=/data. The offline flag turns a missing file into a startup error instead of
# a download.
ENV HUGGINGFACE_HUB_CACHE=/data \
    HF_HUB_OFFLINE=1
LABEL io.pharmacycentral.embedding-model="${MODEL_ID}@${MODEL_REVISION}"
# Non-root, like the Node services. The model directory is read-only at runtime.
USER 10001:10001
