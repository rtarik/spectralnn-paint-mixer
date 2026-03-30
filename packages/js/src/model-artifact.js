function cloneVector(values) {
  return values.map((value) => Number(value));
}

function cloneMatrix(rows) {
  return rows.map((row) => cloneVector(row));
}

function requireLength(name, values, expectedLength) {
  if (values.length !== expectedLength) {
    throw new Error(`${name} expected length ${expectedLength}, got ${values.length}`);
  }
}

function requireMatrixShape(name, rows, expectedRows, expectedCols) {
  if (rows.length !== expectedRows) {
    throw new Error(`${name} expected ${expectedRows} rows, got ${rows.length}`);
  }
  for (const row of rows) {
    if (row.length !== expectedCols) {
      throw new Error(`${name} expected row length ${expectedCols}, got ${row.length}`);
    }
  }
}

export function createRuntimeModelArtifact(source) {
  const artifact = typeof source === 'string' ? JSON.parse(source) : source;
  if (!artifact || typeof artifact !== 'object') {
    throw new TypeError('Expected a parsed model artifact object or JSON string');
  }

  const hiddenDims = cloneVector(artifact.network.hiddenDims);
  if (hiddenDims.length !== 2) {
    throw new Error(`Expected exactly 2 hidden layers, got ${hiddenDims.length}`);
  }

  const inputDim = Number(artifact.network.inputDim);
  const outputDim = Number(artifact.network.outputDim);
  const [hidden1Dim, hidden2Dim] = hiddenDims;

  const featureMean = cloneVector(artifact.normalization.featureMean);
  const featureStd = cloneVector(artifact.normalization.featureStd);
  const targetMean = cloneVector(artifact.normalization.targetMean);
  const targetStd = cloneVector(artifact.normalization.targetStd);
  const w1 = cloneMatrix(artifact.network.weights.w1);
  const b1 = cloneVector(artifact.network.weights.b1);
  const w2 = cloneMatrix(artifact.network.weights.w2);
  const b2 = cloneVector(artifact.network.weights.b2);
  const w3 = cloneMatrix(artifact.network.weights.w3);
  const b3 = cloneVector(artifact.network.weights.b3);

  requireLength('featureMean', featureMean, inputDim);
  requireLength('featureStd', featureStd, inputDim);
  requireLength('targetMean', targetMean, outputDim);
  requireLength('targetStd', targetStd, outputDim);
  requireLength('b1', b1, hidden1Dim);
  requireLength('b2', b2, hidden2Dim);
  requireLength('b3', b3, outputDim);
  requireMatrixShape('w1', w1, hidden1Dim, inputDim);
  requireMatrixShape('w2', w2, hidden2Dim, hidden1Dim);
  requireMatrixShape('w3', w3, outputDim, hidden2Dim);

  return {
    artifactVersion: Number(artifact.artifactVersion),
    modelId: artifact.modelId,
    createdAt: artifact.createdAt,
    baseEngineId: artifact.runtimeContract.baseEngineId,
    mixingParameters: { ...artifact.mixingParameters },
    inputDim,
    hiddenDims,
    outputDim,
    featureMean,
    featureStd,
    targetMean,
    targetStd,
    w1,
    b1,
    w2,
    b2,
    w3,
    b3,
  };
}
