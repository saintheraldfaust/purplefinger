const axios = require('axios');
const config = require('./config');

const RUNPOD_API = 'https://api.runpod.io/graphql';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.RUNPOD_API_KEY}`,
});

async function startPod() {
  const chain = config.RUNPOD_GPU_FALLBACK_CHAIN;
  if (!chain || chain.length === 0) {
    throw new Error('No GPUs configured in RUNPOD_GPU_FALLBACK_CHAIN');
  }

  // --- Volume logic (commented out — region-locks GPU availability) ---
  // if (config.RUNPOD_NETWORK_VOLUME_ID) {
  //   try {
  //     const pod = await _deployPod(chain[0], config.RUNPOD_NETWORK_VOLUME_ID);
  //     console.log(`Pod started WITH network volume (${config.RUNPOD_NETWORK_VOLUME_ID})`);
  //     return { pod, gpuType: chain[0] };
  //   } catch (err) {
  //     const msg = String(err?.message || '').toLowerCase();
  //     const isCapacity = /no longer any instances|no available gpu|capacity|no gpu/i.test(msg);
  //     if (!isCapacity) throw err;
  //     console.log(`No GPUs available with volume — falling through to chain...`);
  //   }
  // }

  // Walk the chain cheapest-first; skip capacity errors, throw real errors.
  let lastErr = null;
  for (const gpuType of chain) {
    try {
      console.log(`Trying GPU: ${gpuType}...`);
      const pod = await _deployPod(gpuType, null);
      console.log(`Pod started on ${gpuType}`);
      return { pod, gpuType };
    } catch (err) {
      const msg = String(err?.message || '');
      const isCapacity = /no longer any instances|no available gpu|capacity|no gpu/i.test(msg);
      if (!isCapacity) throw err; // real error — abort
      console.log(`No capacity for ${gpuType}, trying next...`);
      lastErr = err;
    }
  }

  // All GPUs exhausted
  throw lastErr || new Error('No GPU capacity available on any configured type');
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
