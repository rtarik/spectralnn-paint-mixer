import bundledArtifactJson from './generated/default-model-artifact-data.js';
import { createRuntimeModelArtifact } from './model-artifact.js';

export const defaultModelArtifact = createRuntimeModelArtifact(bundledArtifactJson);
