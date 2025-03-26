const sanityClient = require("@sanity/client");

// For read-only operations
const readClient = sanityClient.createClient({
  projectId: "0y2a624a",
  dataset: "production",
  apiVersion: "2023-05-03",
  useCdn: true,
});

// For write operations (keep this server-side only)
const writeClient = sanityClient.createClient({
  projectId: "0y2a624a",
  dataset: "production",
  apiVersion: "2023-05-03",
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
});

module.exports = {
  readClient,
  writeClient,
};
