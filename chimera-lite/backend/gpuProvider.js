const axios = require('axios');
const config = require('./config');

const RUNPOD_API = 'https://api.runpod.io/graphql';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.RUNPOD_API_KEY}`,
});

async function startPod() {
  const mutation = `
    mutation {
      podFindAndDeployOnDemand(input: {
        gpuCount: 1,
        volumeInGb: 0,
        containerDiskInGb: ${config.RUNPOD_CONTAINER_DISK_GB},
        minVcpuCount: 2,
        minMemoryInGb: 16,
        gpuTypeId: "${config.RUNPOD_GPU_TYPE}",
        name: "chimera-lite-session",
        templateId: "${config.RUNPOD_TEMPLATE_ID}",
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
