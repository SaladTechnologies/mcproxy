import type { LocationInfo } from '@mcproxy/shared';

// ip-api.com response format
interface IpApiResponse {
  status: 'success' | 'fail';
  message?: string;
  query: string;        // IP address
  country: string;
  countryCode: string;
  region: string;       // Region code (e.g., "UT")
  regionName: string;   // Full region name (e.g., "Utah")
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  as: string;           // AS number and name
  continent: string;
  continentCode: string;
}

export class LocationService {
  private cachedLocation: LocationInfo | null = null;
  private cacheExpiry: number = 0;
  private cacheDurationMs: number;

  constructor(options: { cacheDurationMs?: number } = {}) {
    // Cache location for 1 hour by default (IP shouldn't change for a container)
    this.cacheDurationMs = options.cacheDurationMs ?? 60 * 60 * 1000;
  }

  async getLocation(): Promise<LocationInfo> {
    // Return cached location if still valid
    if (this.cachedLocation && Date.now() < this.cacheExpiry) {
      return this.cachedLocation;
    }

    try {
      const location = await this.fetchLocation();
      this.cachedLocation = location;
      this.cacheExpiry = Date.now() + this.cacheDurationMs;
      return location;
    } catch (err) {
      console.error('Failed to fetch location:', err);
      // Return minimal location info if fetch fails
      return this.getMinimalLocation();
    }
  }

  private async fetchLocation(): Promise<LocationInfo> {
    // Use ip-api.com - free, no API key required
    // Note: Has rate limit of 45 requests per minute for free tier
    const response = await fetch(
      'http://ip-api.com/json/?fields=status,message,query,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,continent,continentCode'
    );

    if (!response.ok) {
      throw new Error(`IP API request failed: ${response.status}`);
    }

    const data = await response.json() as IpApiResponse;

    if (data.status === 'fail') {
      throw new Error(`IP API error: ${data.message}`);
    }

    // Parse ASN from "AS" field (format: "AS12345 Organization Name")
    const asnMatch = data.as?.match(/^(AS\d+)/);
    const asn = asnMatch ? asnMatch[1] : undefined;

    const location: LocationInfo = {
      ip: data.query,
      city: data.city,
      region: data.regionName,
      regionCode: data.region,
      country: data.country,
      countryCode: data.countryCode,
      continent: data.continent,
      continentCode: data.continentCode,
      latitude: data.lat,
      longitude: data.lon,
      timezone: data.timezone,
      isp: data.isp,
      org: data.org,
      asn,
    };

    // Add Salad-specific info from environment if available
    if (process.env.SALAD_MACHINE_ID) {
      location.saladMachineId = process.env.SALAD_MACHINE_ID;
    }
    if (process.env.SALAD_CONTAINER_ID) {
      location.saladContainerId = process.env.SALAD_CONTAINER_ID;
    }

    console.log(`Location detected: ${location.city}, ${location.regionCode}, ${location.countryCode} (${location.ip})`);
    return location;
  }

  private async getMinimalLocation(): Promise<LocationInfo> {
    // Try to at least get the public IP
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json() as { ip: string };
      return { ip: data.ip };
    } catch {
      return { ip: 'unknown' };
    }
  }

  // Force refresh the cached location
  async refreshLocation(): Promise<LocationInfo> {
    this.cachedLocation = null;
    this.cacheExpiry = 0;
    return this.getLocation();
  }
}

// Singleton instance
let locationServiceInstance: LocationService | null = null;

export function getLocationService(): LocationService {
  if (!locationServiceInstance) {
    locationServiceInstance = new LocationService();
  }
  return locationServiceInstance;
}
