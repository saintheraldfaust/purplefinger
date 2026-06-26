"""
Convert an ONNX model to a TensorRT FP16 .plan file.
Run this on the GPU node before starting the inference server.

Usage:
  python build_engine.py --onnx models/faceshifter.onnx --output models/faceshifter_fp16.plan --fp16
"""

import argparse
import tensorrt as trt


def build(onnx_path: str, output_path: str, fp16: bool):
    logger = trt.Logger(trt.Logger.INFO)
    builder = trt.Builder(logger)
    network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
    parser = trt.OnnxParser(network, logger)

    with open(onnx_path, 'rb') as f:
        if not parser.parse(f.read()):
            for i in range(parser.num_errors):
                print(parser.get_error(i))
            raise RuntimeError('ONNX parse failed')

    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 4 << 30)  # 4GB

    if fp16:
        config.set_flag(trt.BuilderFlag.FP16)

    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise RuntimeError('TRT engine build failed')

    with open(output_path, 'wb') as f:
        f.write(serialized)

    print(f'Engine saved to {output_path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--onnx', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--fp16', action='store_true')
    args = parser.parse_args()
    build(args.onnx, args.output, args.fp16)
