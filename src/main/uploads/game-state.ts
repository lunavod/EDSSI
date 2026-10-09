import type { JournalEvent } from '../../shared/journal';

/**
 * What the uploads need to know that a single journal line doesn't say: who is playing, which game
 * build, where they are, and in which ship. Both EDSM and Inara want that attached to events that
 * leave it out (a `MissionAccepted` doesn't name the station it was accepted at).
 */
export interface GameState {
  commander?: string;
  frontierId?: string;
  gameVersion?: string;
  gameBuild?: string;
  /** Aboard another commander's ship. Their journal is the one that counts, so nothing is sent. */
  inCrew: boolean;
  systemName?: string;
  systemAddress?: number | bigint;
  coordinates?: [number, number, number];
  stationName?: string;
  marketId?: number;
  shipId?: number;
  /** The journal's own name for the ship type, e.g. `krait_mkii`. */
  shipType?: string;
  shipName?: string;
  shipIdent?: string;
  /** Riding an Apex shuttle or a Frontline dropship rather than flying. */
  taxi: boolean;
}

export function initialGameState(): GameState {
  return { inCrew: false, taxi: false };
}

/**
 * Both services only take the live galaxy: no betas, and nothing from the Horizons 3.8 "legacy"
 * client, whose journals say `3.8…`.
 */
export function liveGalaxyProblem(state: GameState): string | undefined {
  const version = state.gameVersion;
  if (version === undefined) return 'Waiting for the game to say which version it is.';
  if (/beta/i.test(version) || /beta/i.test(state.gameBuild ?? '')) {
    return `Game version ${version} is a beta, which isn't sent.`;
  }
  const major = Number.parseInt(version, 10);
  if (!Number.isFinite(major) || major < 4) {
    return `Game version ${version} is the legacy galaxy, which isn't sent.`;
  }
  return undefined;
}

/** Folds one event into the state. Payloads aren't validated, so every field is checked. */
export function updateGameState(state: GameState, event: JournalEvent): GameState {
  switch (event.event) {
    case 'Fileheader': {
      const version = { gameVersion: event.gameversion, gameBuild: event.build?.trim() };
      // A later part of the same game carries on where the last file stopped; a new game starts
      // over, keeping only the ship until LoadGame says otherwise.
      if (event.part > 1) return { ...state, ...version };
      return {
        ...initialGameState(),
        shipId: state.shipId,
        shipType: state.shipType,
        shipName: state.shipName,
        shipIdent: state.shipIdent,
        ...version,
      };
    }
    case 'Commander':
      return { ...state, commander: event.Name, frontierId: event.FID, inCrew: false };
    case 'LoadGame':
      return {
        ...state,
        commander: event.Commander,
        frontierId: event.FID,
        gameVersion: event.gameversion ?? state.gameVersion,
        gameBuild: event.build?.trim() ?? state.gameBuild,
        inCrew: false,
        taxi: false,
        // On foot (Odyssey) LoadGame names a suit rather than a ship; keep the last ship.
        ...(event.ShipID !== undefined && isShip(event.Ship)
          ? {
              shipId: event.ShipID,
              shipType: event.Ship?.toLowerCase(),
              shipName: event.ShipName,
              shipIdent: event.ShipIdent,
            }
          : {}),
      };
    case 'Location':
    case 'CarrierJump':
      return {
        ...state,
        ...arrival(event),
        stationName: event.Docked ? event.StationName : undefined,
        marketId: event.Docked ? event.MarketID : undefined,
        taxi: event.Taxi ?? state.taxi,
      };
    case 'FSDJump':
      return {
        ...state,
        ...arrival(event),
        stationName: undefined,
        marketId: undefined,
        taxi: event.Taxi ?? state.taxi,
      };
    case 'Docked':
      return {
        ...state,
        systemName: event.StarSystem ?? state.systemName,
        systemAddress: event.SystemAddress ?? state.systemAddress,
        stationName: event.StationName,
        marketId: event.MarketID,
        taxi: event.Taxi ?? state.taxi,
      };
    case 'Undocked':
      return { ...state, stationName: undefined, marketId: undefined };
    case 'Embark':
    case 'Disembark':
      return { ...state, taxi: event.event === 'Embark' && event.Taxi };
    case 'Loadout':
      return isShip(event.Ship)
        ? {
            ...state,
            shipId: event.ShipID,
            shipType: event.Ship.toLowerCase(),
            shipName: event.ShipName,
            shipIdent: event.ShipIdent,
          }
        : state;
    case 'ShipyardSwap':
      return { ...state, shipId: event.ShipID, shipType: event.ShipType?.toLowerCase() };
    case 'ShipyardNew':
      return { ...state, shipId: event.NewShipID, shipType: event.ShipType?.toLowerCase() };
    case 'SetUserShipName':
      return event.ShipID === state.shipId
        ? { ...state, shipName: event.UserShipName, shipIdent: event.UserShipId }
        : state;
    case 'JoinACrew':
      return { ...state, inCrew: true };
    case 'QuitACrew':
      return { ...state, inCrew: false };
    default:
      return state;
  }
}

type Arrival = Extract<JournalEvent, { event: 'Location' | 'FSDJump' | 'CarrierJump' }>;

function arrival(event: Arrival): Partial<GameState> {
  const position = event.StarPos;
  return {
    systemName: event.StarSystem,
    systemAddress: event.SystemAddress,
    coordinates:
      Array.isArray(position) && position.length === 3 && position.every(Number.isFinite)
        ? position
        : undefined,
  };
}

/** Suits, SRVs and fighters show up where a ship would; those aren't ships. */
function isShip(type: string | undefined): type is string {
  return typeof type === 'string' && type !== '' && !/suit|buggy|srv|fighter/i.test(type);
}
