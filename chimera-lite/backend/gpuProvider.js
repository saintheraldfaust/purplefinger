const axios = require('axios');
const config = require('./config');

const RUNPOD_API = 'https://api.runpod.io/graphql';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.RUNPOD_API_KEY}`,
});

async function startPod(gpuType = config.RUNPOD_GPU_TYPE) {
  // First try with network volume (faster cold start — models already cached).
  // If that fails (volume is region-locked, no GPUs in that region), retry without it.
  if (config.RUNPOD_NETWORK_VOLUME_ID) {
    try {
      const pod = await _deployPod(gpuType, config.RUNPOD_NETWORK_VOLUME_ID);
      console.log(`Pod started WITH network volume (${config.RUNPOD_NETWORK_VOLUME_ID})`);
      return pod;
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      const isCapacity = /no longer any instances|no available gpu|capacity|no gpu/i.test(msg);
      if (!isCapacity) throw err; // real error, don't retry
      console.log(`No GPUs available with volume — retrying without volume...`);
    }
  }

  // Retry (or first attempt) without network volume
  const pod = await _deployPod(gpuType, null);
  console.log('Pod started WITHOUT network volume (models will download on boot)');
  return pod;
}

async function _deployPod(gpuType, networkVolumeId) {
  const networkVolumeField = networkVolumeId
    ? `networkVolumeId: "${networkVolumeId}",`
    : '';

  const mutation = `
    mutation {
      podFindAndDeployOnDemand(input: {
        gpuCount: 1,
        volumeInGb: 0,
        containerDiskInGb: ${config.RUNPOD_CONTAINER_DISK_GB},
        minVcpuCount: 2,
        minMemoryInGb: 16,
        gpuTypeId: "${gpuType}",
        name: "chimera-lite-session",
        templateId: "${config.RUNPOD_TEMPLATE_ID}",
        ${networkVolumeField}
        startSsh: true,
        ports: "8765/tcp",
        cloudType: ALL
      }) {
        id
        desiredStatus
        imageName
        runtime {
          uptimeInSeconds
          ports {
            ip
            isIpPublic
            privatePort
            publicPort
            type
          }
        }
      }
    }
  `;

  const res = await axios.post(RUNPOD_API, { query: mutation }, { headers: headers() });

  if (res.data.errors) {
    throw new Error(res.data.errors[0].message);
  }

  return res.data.data.podFindAndDeployOnDemand;
}

async function stopPod(podId) {
  const mutation = `
    mutation {
      podTerminate(input: { podId: "${podId}" })
    }
  `;

  const res = await axios.post(RUNPOD_API, { query: mutation }, { headers: headers() });

  if (res.data.errors) {
    throw new Error(res.data.errors[0].message);
  }

  return true;
}

async function getPodStatus(podId) {
  const query = `
    query {
      pod(input: { podId: "${podId}" }) {
        id
        desiredStatus
        lastStatusChange
        runtime {
          uptimeInSeconds
          ports {
            ip
            isIpPublic
            privatePort
            publicPort
            type
          }
        }
      }
    }
  `;

  const res = await axios.post(RUNPOD_API, { query }, { headers: headers() });

  if (res.data.errors) {
    throw new Error(res.data.errors[0].message);
  }

  return res.data.data.pod;
}

// Extract the public IP + mapped port for our WebRTC/inference server (port 8765)
function extractEndpoint(pod) {
  const ports = pod?.runtime?.ports || [];
  const entry = ports.find(p => p.privatePort === 8765 && p.isIpPublic);
  if (!entry) return null;
  return { ip: entry.ip, port: entry.publicPort };
}

module.exports = { startPod, stopPod, getPodStatus, extractEndpoint };
