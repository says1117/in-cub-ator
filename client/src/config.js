// Production kiosk connects to the backend on the same host; explicit env wins.
export const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8000`;
