# Trains one Groundwork model from a twin dataset and exports ONNX

Input: {"model": "gw-worker-path", "dataset": <output of gw-site-twin op dataset>}. Output: the ONNX file base64, metrics, input schema and a model card. Run by the gw-train-models pipeline.
