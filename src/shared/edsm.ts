/** What EDSM (www.edsm.net) knows about a system that the journal doesn't. */
export interface SystemExternalInfo {
  name: string;
  /** `unknown`: EDSM has never heard of the system. `unavailable`: EDSM couldn't be reached. */
  status: 'ok' | 'unknown' | 'unavailable';
  /** Ships EDSM users saw in the system. */
  traffic?: Counts;
  /** Ships EDSM users lost in the system. */
  deaths?: Counts;
  primaryStar?: { type: string; scoopable: boolean };
  /** The station nearest the arrival star, fleet carriers aside. */
  closestStarport?: { name: string; type: string; distanceLs: number };
}

export interface Counts {
  day: number;
  week: number;
  total: number;
}
