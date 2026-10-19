import { defineRailway, github, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const columnVolume = volume("column-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 5000 });
  const Column = service("Column", {
    source: github("whirleyjoshua-netizen/Column", { branch: "main", checkSuites: false }),
    build: { buildCommand: "npm --prefix server ci --omit=dev", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "node server/index.js",
    healthcheck: "/api/health",
    replicas: { "us-west2": 1 },
    domains: ["column.premiershadesolutions.com"],
    networking: { privateNetworkEndpoint: "column" },
    volumeMounts: { "/data": columnVolume },
  });

  return project("Column", {
    variables: { managed: false },
    resources: [Column, columnVolume],
  });
});
