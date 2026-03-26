const axios = require('axios');
const config = require('./config');

const RUNPOD_API = 'https://api.runpod.io/graphql';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.RUNPOD_API_KEY}`,
});

const CAPACITY_RE = /no longer any instances|no available gpu|capacity|no gpu|does not have the resources|insufficient resources|out of stock/i;

async function startPod() {
  const chain = config.RUNPOD_GPU_FALLBACK_CHAIN;
  if (!chain || chain.length === 0) {
    throw new Error('No GPUs configured in RUNPOD_GPU_FALLBACK_CHAIN');
  }

  const maxRetries = config.GPU_START_MAX_RETRIES || 5;
  const retryDelay = config.GPU_START_RETRY_DELAY_MS || 15000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Walk the chain cheapest-first; skip capacity errors, throw real errors.
    let lastErr = null;
    for (const gpuType of chain) {
      try {
        console.log(`[Attempt ${attempt}/${maxRetries}] Trying GPU: ${gpuType}...`);
        const pod = await _deployPod(gpuType, null);
        console.log(`Pod started on ${gpuType} (attempt ${attempt})`);
        return { pod, gpuType };
      } catch (err) {
        const msg = String(err?.message || '');
        if (!CAPACITY_RE.test(msg)) throw err; // real error — abort
        console.log(`No capacity for ${gpuType}, trying next...`);
        lastErr = err;
      }
    }

    // All GPUs exhausted for this attempt
    if (attempt < maxRetries) {
      console.log(`All GPUs exhausted on attempt ${attempt}/${maxRetries}. Retrying in ${retryDelay / 1000}s...`);
      await new Promise(r => setTimeout(r, retryDelay));
    } else {
      throw lastErr || new Error('No GPU capacity available on any configured type');
    }
  }
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
