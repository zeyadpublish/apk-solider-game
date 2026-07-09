import { type FormEvent, type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  Bomb,
  Bot,
  Check,
  Crosshair,
  Home,
  LogOut,
  Map,
  RadioTower,
  RotateCcw,
  Search,
  Send,
  Shield,
  Swords,
  Trophy,
  UserPlus,
  Users,
  X,
} from "lucide-react";

type AuthMode = "signin" | "signup";
type UiPanel = "friends" | "challenge" | "leaderboard" | "levels" | null;
type WeaponAnimation = "idle" | "fire" | "reload" | "throw";
type CombatMode = "idle" | "solo" | "duel";
type AssetProgressKey = "manifest" | "city" | "soldier" | "weapon";

interface SessionUser {
  id: number;
  username: string;
}

interface AuthSession {
  token: string;
  user: SessionUser;
}

interface WorldSlot {
  url: string;
  scale: number;
  position: [number, number, number];
  rotation: [number, number, number];
}

interface TransformSlot {
  scale: number;
  position: [number, number, number];
  rotation: [number, number, number];
}

interface SoldierSlot extends WorldSlot {
  animation: string;
}

interface WeaponSlot extends WorldSlot {
  animations?: Partial<Record<WeaponAnimation, string>>;
  playerMount?: TransformSlot;
}

interface EnemyVariant {
  id: string;
  displayName: string;
  role: "rifleman" | "heavy" | "sniper" | "commander";
  health: number;
  armor: number;
  damage: number;
  speed: number;
  scale: number;
}

interface AssetManifest {
  projectTitle: string;
  creator: string;
  world: WorldSlot;
  soldier: SoldierSlot;
  weapon?: WeaponSlot;
  enemyVariants: EnemyVariant[];
  spawn: {
    player: {
      position: [number, number, number];
      rotation: [number, number, number];
    };
  };
}

interface FriendSummary {
  id: number;
  friend: SessionUser;
}

interface FriendRequestSummary {
  id: number;
  from?: SessionUser;
  to?: SessionUser;
}

interface ChallengeSummary {
  id: number;
  mission: string;
  status: string;
  direction: "incoming" | "outgoing";
  friend: SessionUser;
}

interface FriendsPayload {
  friends: FriendSummary[];
  incoming: FriendRequestSummary[];
  outgoing: FriendRequestSummary[];
  challenges: ChallengeSummary[];
}

interface SearchResult {
  id: number;
  username: string;
  friendshipStatus: string | null;
  friendshipId: number | null;
}

interface HudSnapshot {
  loading: boolean;
  loadingProgress: number;
  message: string;
  health: number;
  armor: number;
  stamina: number;
  ammo: number;
  reserve: number;
  enemies: number;
  mode: "ambient" | "solo" | "duel";
  kills: number;
  fps: number;
  levelName: string;
  gameOver: boolean;
  missionComplete: boolean;
  paused: boolean;
}

interface LeaderboardPlayer {
  username: string;
  kills: number;
  deaths: number;
  matches: number;
}

interface SoloLevel {
  id: string;
  name: string;
  location: string;
  description: string;
  enemyCount: number;
  playerSpawn: [number, number, number];
  enemyRadius: number;
  difficulty: number;
}

interface EnemyRuntime {
  id: string;
  variant: EnemyVariant;
  object: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  action: THREE.AnimationAction | null;
  health: number;
  armor: number;
  state: "patrol" | "advance" | "shoot" | "throw" | "down";
  cooldown: number;
  bombCooldown: number;
  patrolAngle: number;
  deathPoseApplied: boolean;
}

interface ProjectileRuntime {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  owner: "player" | "enemy";
}

interface TraceRuntime {
  line: THREE.Line;
  life: number;
}

interface DuelNetworkMessage {
  type?: string;
  username?: string;
  mission?: string;
  mode?: string;
  attacker?: string;
  players?: Array<{ username: string; position: [number, number, number]; health: number }>;
  position?: [number, number, number];
  health?: number;
  amount?: number;
}

interface FlagCloth {
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  previous: Float32Array;
  original: Float32Array;
  cols: number;
  rows: number;
  restX: number;
  restY: number;
}

declare global {
  interface Window {
    FRONTLINE_API_BASE_URL?: string;
    FRONTLINE_WS_BASE_URL?: string;
  }
}

const MANIFEST_URL = "/assets/official/asset-manifest.json";
const TOKEN_KEY = "frontline_auth_token";
const USER_KEY = "frontline_auth_user";
const API_BASE_URL = normalizeBaseUrl(window.FRONTLINE_API_BASE_URL ?? import.meta.env.VITE_API_BASE_URL);
const WS_BASE_URL = normalizeBaseUrl(window.FRONTLINE_WS_BASE_URL ?? import.meta.env.VITE_WS_BASE_URL);
const ONLINE_CONFIG_ERROR =
  "Online login and 1v1 need a hosted API URL. Add FRONTLINE_API_BASE_URL in Codemagic, then rebuild the APK.";
const ENEMY_STOP_DISTANCE = 3;
const PLAYER_BODY_RADIUS = 0.42;
const PLAYER_BUILDING_RADIUS = 0.22;
const ENEMY_BUILDING_RADIUS = 0.24;
const ENEMY_BODY_RADIUS = 1.45;
const ENEMY_DEAD_BODY_RADIUS = 1.1;
const BUILDING_BOX_HORIZONTAL_PADDING = 0.08;
const BUILDING_BOX_VERTICAL_PADDING = 0.05;
const BACKLOT_BLOCKER_DEPTH = 72;
const BACKLOT_BLOCKER_MARGIN = 10;
const BACKLOT_BLOCKER_HEIGHT = 22;
const ENEMY_DEATH_FACE_UP_PITCH = Math.PI / 2;
const ENEMY_DEATH_GROUND_CLEARANCE = -0.02;
const ENEMY_DEATH_MAX_LIFT = 0.04;
const ASSET_PROGRESS_WEIGHTS: Record<AssetProgressKey, number> = {
  manifest: 8,
  city: 34,
  soldier: 40,
  weapon: 18,
};

const EMPTY_HUD: HudSnapshot = {
  loading: true,
  loadingProgress: 0,
  message: "Loading UAE War City",
  health: 100,
  armor: 100,
  stamina: 100,
  ammo: 30,
  reserve: 120,
  enemies: 0,
  mode: "ambient",
  kills: 0,
  fps: 60,
  levelName: "City Patrol",
  gameOver: false,
  missionComplete: false,
  paused: false,
};

const SOLO_LEVELS: SoloLevel[] = [
  {
    id: "city-patrol",
    name: "City Patrol",
    location: "Downtown corridor",
    description: "Clear the first street line and learn the iPad controls.",
    enemyCount: 5,
    playerSpawn: [0, 1.7, 12],
    enemyRadius: 22,
    difficulty: 0.75,
  },
  {
    id: "tower-defense",
    name: "Tower Defense",
    location: "High-rise district",
    description: "Fight through tighter building gaps while the UAE flag anchors the skyline.",
    enemyCount: 8,
    playerSpawn: [-10, 1.7, 16],
    enemyRadius: 34,
    difficulty: 1,
  },
  {
    id: "commander-hunt",
    name: "Commander Hunt",
    location: "Command sector",
    description: "Heavy units and commanders push in coordinated waves.",
    enemyCount: 12,
    playerSpawn: [16, 1.7, 24],
    enemyRadius: 48,
    difficulty: 1.28,
  },
];

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : "";
}

function appendPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function isPackagedAppWithoutApi(): boolean {
  if (API_BASE_URL) return false;
  if (window.location.protocol === "capacitor:" || window.location.protocol === "file:") return true;
  return window.location.hostname === "localhost" && window.location.port === "";
}

function apiUrl(path: string): string {
  if (isPackagedAppWithoutApi()) throw new Error(ONLINE_CONFIG_ERROR);
  const apiPath = `/api${path.startsWith("/") ? path : `/${path}`}`;
  if (!API_BASE_URL) return apiPath;
  return API_BASE_URL.endsWith("/api")
    ? appendPath(API_BASE_URL, path)
    : appendPath(API_BASE_URL, apiPath);
}

function httpBaseToWsBase(baseUrl: string): string {
  if (baseUrl.startsWith("https://")) return `wss://${baseUrl.slice("https://".length)}`;
  if (baseUrl.startsWith("http://")) return `ws://${baseUrl.slice("http://".length)}`;
  return baseUrl;
}

function duelSocketUrl(token: string): string {
  if (!WS_BASE_URL && isPackagedAppWithoutApi()) throw new Error(ONLINE_CONFIG_ERROR);
  const base = WS_BASE_URL || (API_BASE_URL ? httpBaseToWsBase(API_BASE_URL) : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`);
  const wsPath = API_BASE_URL.endsWith("/api") || WS_BASE_URL.endsWith("/api") ? "/ws" : "/api/ws";
  return `${appendPath(base, wsPath)}?token=${encodeURIComponent(token)}`;
}

async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...options, headers });
  } catch (error) {
    throw new Error(error instanceof Error && error.message === ONLINE_CONFIG_ERROR ? error.message : "Online services are not reachable. Check the hosted API URL used by the APK.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status >= 500) {
      throw new Error("Online services need the API server and a real DATABASE_URL. Solo AI works offline.");
    }
    throw new Error(typeof data.error === "string" ? data.error : `Request failed: ${response.status}`);
  }
  return data as T;
}

function arrayField<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function numberField(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function stringField(value: unknown, fallback = "Friend"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function publicSessionUser(value: unknown, fallbackId = 0, fallbackUsername = "Friend"): SessionUser {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: numberField(record.id, fallbackId),
    username: stringField(record.username, fallbackUsername),
  };
}

function normalizeFriendsPayload(payload: Partial<FriendsPayload> | null | undefined, currentUserId: number): FriendsPayload {
  const explicitIncoming = arrayField<FriendRequestSummary>(payload?.incoming);
  const explicitOutgoing = arrayField<FriendRequestSummary>(payload?.outgoing);
  const explicitChallenges = arrayField<ChallengeSummary>(payload?.challenges);
  const friendRows = arrayField<Record<string, unknown>>(payload?.friends);
  const friends: FriendSummary[] = [];
  const incoming: FriendRequestSummary[] = [...explicitIncoming];
  const outgoing: FriendRequestSummary[] = [...explicitOutgoing];

  for (const row of friendRows) {
    const status = stringField(row.status, "accepted").toLowerCase();
    const id = numberField(row.id);
    const fromId = numberField(row.fromUserId ?? row.userId ?? row.requesterId);
    const toId = numberField(row.toUserId ?? row.friendId ?? row.addresseeId);
    const otherId = fromId === currentUserId ? toId : fromId;
    const username = stringField(row.username ?? (row.friend as SessionUser | undefined)?.username, "Friend");

    if (row.friend && typeof row.friend === "object") {
      friends.push({ id, friend: publicSessionUser(row.friend, otherId, username) });
      continue;
    }

    if (status === "accepted") {
      friends.push({ id, friend: { id: otherId, username } });
      continue;
    }

    if (status === "pending" && toId === currentUserId) {
      incoming.push({ id, from: { id: fromId, username } });
      continue;
    }

    if (status === "pending" && fromId === currentUserId) {
      outgoing.push({ id, to: { id: toId, username } });
    }
  }

  return { friends, incoming, outgoing, challenges: explicitChallenges };
}

function normalizeLeaderboardPayload(payload: unknown): LeaderboardPlayer[] {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rows = arrayField<Record<string, unknown>>(record.players ?? record.leaderboard);
  return rows.map((row) => ({
    username: String(row.username ?? "unknown"),
    kills: Number(row.kills ?? 0),
    deaths: Number(row.deaths ?? 0),
    matches: Number(row.matches ?? (Number(row.wins ?? 0) + Number(row.losses ?? 0))),
  }));
}

function normalizeSessionUser(payload: { user?: Partial<SessionUser> | null; username?: string }): SessionUser {
  const user = payload.user ?? {};
  return {
    id: Number(user.id ?? 0),
    username: String(user.username ?? payload.username ?? "Player"),
  };
}

function restoreSession(): AuthSession | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const rawUser = localStorage.getItem(USER_KEY);
  if (!token || !rawUser) return null;
  try {
    return { token, user: normalizeSessionUser({ user: JSON.parse(rawUser) as Partial<SessionUser> }) };
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

function storeSession(session: AuthSession | null) {
  if (!session) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, session.token);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

function createMaterialFromSource(source: THREE.Material | THREE.Material[], meshName: string): THREE.Material | THREE.Material[] {
  if (Array.isArray(source)) return source.map((material) => createMaterialFromSource(material, meshName) as THREE.Material);

  const original = source as THREE.MeshStandardMaterial;
  const label = `${source.name ?? ""} ${meshName}`.toLowerCase();
  const isGlass = /glass|window|facade|mirror|tower/.test(label);

  if (isGlass) {
    return new THREE.MeshPhysicalMaterial({
      color: original.color?.clone().lerp(new THREE.Color("#9fdcff"), 0.35) ?? new THREE.Color("#9fdcff"),
      map: original.map ?? null,
      transparent: true,
      opacity: 0.34,
      transmission: 0.22,
      roughness: 0.08,
      metalness: 0.04,
      emissive: new THREE.Color("#63d9ff"),
      emissiveIntensity: 0.26,
      clearcoat: 0.8,
      clearcoatRoughness: 0.16,
      depthWrite: false,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: original.color ?? new THREE.Color("#837d6f"),
    map: original.map ?? null,
    normalMap: original.normalMap ?? null,
    roughness: 0.62,
    metalness: 0.18,
    envMapIntensity: 0.82,
  });
}

function createGroundSurfaceMaterial(label: string) {
  const normalized = label.toLowerCase();
  const color = /landscape|grass/.test(normalized) ? "#5e695d" : /curb|basicshape/.test(normalized) ? "#7b7b73" : "#73766d";
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.28,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
}

function createForwardLoopClip(clip: THREE.AnimationClip) {
  const trackStarts = clip.tracks.map((track) => track.times[0] ?? 0);
  const trackEnds = clip.tracks.map((track) => track.times[track.times.length - 1] ?? clip.duration);
  const start = Math.min(...trackStarts);
  const end = Math.max(...trackEnds);
  const duration = Math.max(0.01, end - start);

  const tracks = clip.tracks.map((track) => {
    const clone = track.clone();
    clone.times = Float32Array.from(track.times, (time) => time - start);
    const valueSize = clone.getValueSize();
    if (clone.values.length >= valueSize * 2) {
      clone.values.set(clone.values.slice(0, valueSize), clone.values.length - valueSize);
    }
    return clone;
  });

  return new THREE.AnimationClip(`${clip.name}-forward-loop`, duration, tracks);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

class FrontlineEngine {
  private readonly host: HTMLDivElement;
  private readonly onHud: (snapshot: HudSnapshot) => void;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(82, 1, 0.16, 760);
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    logarithmicDepthBuffer: true,
    powerPreference: "high-performance",
  });
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly keys = new Set<string>();
  private readonly enemies: EnemyRuntime[] = [];
  private readonly collisionMeshes: THREE.Object3D[] = [];
  private readonly buildingBoxes: THREE.Box3[] = [];
  private readonly projectiles: ProjectileRuntime[] = [];
  private readonly traces: TraceRuntime[] = [];
  private readonly pointer = { yaw: Math.PI, pitch: 0 };
  private readonly touchMove = new THREE.Vector2();
  private readonly viewWeapon = new THREE.Group();
  private readonly weaponRest = {
    position: new THREE.Vector3(0.3, -0.32, -0.68),
    rotation: new THREE.Euler(-0.02, -0.08, 0.02),
  };
  private readonly weaponActions: Partial<Record<WeaponAnimation, THREE.AnimationAction>> = {};
  private readonly player = {
    position: new THREE.Vector3(0, 1.7, 12),
    velocity: new THREE.Vector3(),
    health: 100,
    armor: 100,
    stamina: 100,
    ammo: 30,
    reserve: 120,
    shotCooldown: 0,
    reloadTimer: 0,
    bombCooldown: 0,
    damageCooldown: 0,
    graceTimer: 0,
    kills: 0,
  };
  private manifest: AssetManifest | null = null;
  private soldierTemplate: THREE.Group | null = null;
  private soldierAnimations: THREE.AnimationClip[] = [];
  private soldierBaseScale = 1;
  private weaponTemplate: THREE.Group | null = null;
  private weaponSlot: WeaponSlot | null = null;
  private weaponMixer: THREE.AnimationMixer | null = null;
  private currentLevel: SoloLevel = SOLO_LEVELS[0];
  private combatMode: CombatMode = "idle";
  private duelOpponent = "";
  private duelMissionId = "";
  private duelPlayerName = "";
  private duelToken = "";
  private duelSocket: WebSocket | null = null;
  private duelSyncTimer = 0;
  private active = false;
  private paused = false;
  private missionComplete = false;
  private disposed = false;
  private animationFrame = 0;
  private flag: FlagCloth | null = null;
  private lastHud = 0;
  private fps = 60;
  private loadingProgress = 0;
  private assetProgress: Record<AssetProgressKey, number> = {
    manifest: 0,
    city: 0,
    soldier: 0,
    weapon: 0,
  };

  constructor(host: HTMLDivElement, onHud: (snapshot: HudSnapshot) => void) {
    this.host = host;
    this.onHud = onHud;
  }

  async init() {
    this.configureRenderer();
    this.configureScene();
    this.bindEvents();
    this.host.appendChild(this.renderer.domElement);
    this.resize();
    window.addEventListener("resize", this.resize);
    this.resetAssetProgress();
    this.pushLoadingHud("Preparing UAE War City assets");

    try {
      this.reportAssetProgress("manifest", 0.15, "Loading asset manifest");
      const manifestResponse = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!manifestResponse.ok) throw new Error(`Asset manifest returned ${manifestResponse.status}`);
      this.manifest = (await manifestResponse.json()) as AssetManifest;
      this.reportAssetProgress("manifest", 1, "Asset manifest ready");
      if (!this.manifest.weapon) this.reportAssetProgress("weapon", 1, "No weapon asset required");
      await Promise.all([
        this.loadCity(this.manifest.world),
        this.loadSoldier(this.manifest.soldier),
        this.manifest.weapon ? this.loadWeapon(this.manifest.weapon) : Promise.resolve(),
      ]);
      this.createFlag();
      this.loadingProgress = 100;
      if (this.active && this.combatMode === "duel") {
        this.resetDuel();
      } else if (this.active) {
        this.resetSolo();
      } else {
        this.spawnEnemies();
      }
      this.pushHud(
        this.active
          ? this.combatMode === "duel"
            ? `1v1 duel live: ${this.duelOpponent || "Friend"}`
            : "Solo AI operation active"
          : "Ready for Solo Play with AI",
        false,
      );
    } catch (error) {
      this.pushHud(error instanceof Error ? error.message : "Unable to load game assets", false);
    }

    this.animate();
  }

  setSoloActive(active: boolean) {
    this.active = active;
    if (active) {
      this.disconnectDuelSocket();
      this.combatMode = "solo";
      this.duelOpponent = "";
      this.duelMissionId = "";
      this.duelPlayerName = "";
      this.duelToken = "";
      this.paused = false;
      this.resetSolo();
      this.renderer.domElement.focus({ preventScroll: true });
    } else {
      this.disconnectDuelSocket();
      this.combatMode = "idle";
      this.duelOpponent = "";
      this.duelMissionId = "";
      this.duelPlayerName = "";
      this.duelToken = "";
      this.paused = false;
      this.missionComplete = false;
      this.touchMove.set(0, 0);
      this.keys.clear();
      this.clearCombatEffects();
      if (this.manifest && this.soldierTemplate) this.spawnEnemies();
    }
    this.pushHud(active ? "Solo AI operation active" : "UAE War City standby", false);
  }

  startDuel(opponentName: string, missionId: string, token: string, playerName: string) {
    this.active = true;
    this.combatMode = "duel";
    this.duelOpponent = opponentName || "Friend";
    this.duelMissionId = missionId || `duel-${Date.now()}`;
    this.duelToken = token;
    this.duelPlayerName = playerName;
    this.paused = false;
    this.resetDuel();
    this.connectDuelSocket();
    this.renderer.domElement.focus({ preventScroll: true });
    this.pushHud(`1v1 duel live: ${this.duelOpponent}`, false);
  }

  setLevel(levelId: string) {
    this.currentLevel = SOLO_LEVELS.find((level) => level.id === levelId) ?? SOLO_LEVELS[0];
    if (this.active && this.combatMode === "solo") this.resetSolo();
    else if (this.active && this.combatMode === "duel") this.resetDuel();
    else if (this.manifest && this.soldierTemplate) this.spawnEnemies();
    this.pushHud(this.active ? "Solo AI operation active" : "UAE War City standby", false);
  }

  setPaused(paused: boolean) {
    if (!this.active || this.player.health <= 0 || this.missionComplete) return;
    this.paused = paused;
    if (!paused) this.renderer.domElement.focus({ preventScroll: true });
    this.pushHud(paused ? "Mission paused" : "Solo AI operation active", false);
  }

  setTouchMove(side: number, forward: number) {
    this.touchMove.set(clamp(side, -1, 1), clamp(forward, -1, 1));
  }

  pushTouchLook(dx: number, dy: number) {
    if (!this.active || this.paused || this.missionComplete) return;
    this.pointer.yaw -= dx * 0.004;
    this.pointer.pitch = clamp(this.pointer.pitch - dy * 0.003, -1.1, 1.08);
  }

  fire() {
    this.tryShoot();
  }

  reload() {
    this.startReload();
  }

  throwBomb() {
    this.throwPlayerBomb();
  }

  dispose() {
    this.disposed = true;
    this.disconnectDuelSocket();
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    this.renderer.domElement.removeEventListener("click", this.lockPointer);
    this.renderer.dispose();
    this.host.replaceChildren();
  }

  private configureRenderer() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = "frontline-canvas";
    this.renderer.domElement.tabIndex = 0;
  }

  private configureScene() {
    this.scene.background = new THREE.Color("#9eb4b8");
    this.scene.fog = new THREE.FogExp2("#b9c7bf", 0.0048);

    const hemi = new THREE.HemisphereLight("#dff7ff", "#7f6f54", 1.45);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight("#fff0c7", 6.4);
    sun.position.set(-52, 92, 34);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -140;
    sun.shadow.camera.right = 140;
    sun.shadow.camera.top = 140;
    sun.shadow.camera.bottom = -140;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 260;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight("#8ec9ff", 1.1);
    fill.position.set(45, 32, -80);
    this.scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(650, 650),
      new THREE.MeshStandardMaterial({
        color: "#565d53",
        roughness: 0.9,
        metalness: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: 4,
        polygonOffsetUnits: 4,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.camera.position.copy(this.player.position);
    this.camera.rotation.order = "YXZ";
    this.createViewWeapon();
    this.camera.add(this.viewWeapon);
    this.scene.add(this.camera);
  }

  private createViewWeapon() {
    this.viewWeapon.name = "first-person-rifle";
    this.viewWeapon.position.copy(this.weaponRest.position);
    this.viewWeapon.rotation.copy(this.weaponRest.rotation);

    const dark = new THREE.MeshStandardMaterial({ color: "#151815", roughness: 0.48, metalness: 0.62 });
    const metal = new THREE.MeshStandardMaterial({ color: "#3e443d", roughness: 0.34, metalness: 0.76 });
    const grip = new THREE.MeshStandardMaterial({ color: "#223227", roughness: 0.78, metalness: 0.12 });
    const skin = new THREE.MeshStandardMaterial({ color: "#b89772", roughness: 0.62, metalness: 0.02 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.13, 0.16), metal);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.72, 18), dark);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.14), grip);
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.12), dark);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.32, 18), dark);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.16), skin);

    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(0.48, 0.015, 0);
    stock.position.set(-0.38, -0.01, 0);
    magazine.position.set(0.03, -0.23, 0);
    magazine.rotation.z = 0.12;
    scope.rotation.z = Math.PI / 2;
    scope.position.set(0.08, 0.13, 0);
    hand.position.set(0.22, -0.22, 0.12);

    this.viewWeapon.add(body, barrel, stock, magazine, scope, hand);
    this.viewWeapon.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.castShadow = false;
    });
  }

  private bindEvents() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    this.renderer.domElement.addEventListener("click", this.lockPointer);
  }

  private resize = () => {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape" && this.active) {
      event.preventDefault();
      this.setPaused(!this.paused);
      return;
    }
    this.keys.add(event.code);
    if (event.code === "KeyR") this.startReload();
    if (event.code === "KeyG") this.throwPlayerBomb();
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private onMouseMove = (event: MouseEvent) => {
    if (!this.active || this.paused || this.missionComplete || document.pointerLockElement !== this.renderer.domElement) return;
    this.pointer.yaw -= event.movementX * 0.0022;
    this.pointer.pitch = clamp(this.pointer.pitch - event.movementY * 0.0017, -1.1, 1.08);
  };

  private onMouseDown = (event: MouseEvent) => {
    if (!this.active || this.paused || this.missionComplete || event.button !== 0) return;
    this.tryShoot();
  };

  private lockPointer = () => {
    if (!this.active || this.paused || this.missionComplete) return;
    this.renderer.domElement.requestPointerLock();
  };

  private disconnectDuelSocket() {
    const socket = this.duelSocket;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
    this.duelSocket = null;
    this.duelSyncTimer = 0;
  }

  private connectDuelSocket() {
    this.disconnectDuelSocket();
    if (!this.duelToken || !this.duelMissionId) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(duelSocketUrl(this.duelToken));
    } catch (error) {
      this.pushHud(error instanceof Error ? error.message : ONLINE_CONFIG_ERROR, false);
      return;
    }
    this.duelSocket = socket;

    socket.onopen = () => {
      this.sendDuelMessage({ type: "join", mission: this.duelMissionId, mode: "duel" });
      this.sendDuelState();
    };
    socket.onmessage = (event) => this.handleDuelMessage(event);
    socket.onclose = () => {
      if (this.duelSocket === socket) this.duelSocket = null;
    };
    socket.onerror = () => {};
  }

  private sendDuelMessage(message: Record<string, unknown>) {
    if (!this.duelSocket || this.duelSocket.readyState !== WebSocket.OPEN) return;
    this.duelSocket.send(JSON.stringify(message));
  }

  private sendDuelState() {
    if (this.combatMode !== "duel") return;
    this.sendDuelMessage({
      type: "position",
      position: [this.player.position.x, 0, this.player.position.z],
      health: Math.round(this.player.health),
    });
  }

  private updateDuelNetwork(delta: number) {
    if (this.combatMode !== "duel" || !this.active) return;
    this.duelSyncTimer += delta;
    if (this.duelSyncTimer < 0.08) return;
    this.duelSyncTimer = 0;
    this.sendDuelState();
  }

  private handleDuelMessage(event: MessageEvent) {
    let message: DuelNetworkMessage;
    try {
      message = JSON.parse(String(event.data)) as DuelNetworkMessage;
    } catch {
      return;
    }

    if (message.type === "roster") {
      const opponent = message.players?.find((player) => player.username !== this.duelPlayerName);
      if (opponent) this.applyDuelOpponentState(opponent.username, opponent.position, opponent.health);
      return;
    }

    if (message.type === "player_moved" && message.username && message.username !== this.duelPlayerName) {
      this.applyDuelOpponentState(message.username, message.position, message.health);
      return;
    }

    if (message.type === "duel_hit" && message.attacker !== this.duelPlayerName) {
      const before = this.player.health;
      this.damagePlayer(Number(message.amount ?? 24));
      if (before > 0 && this.player.health <= 0) {
        this.sendDuelState();
      }
    }
  }

  private applyDuelOpponentState(username: string, position?: [number, number, number], health?: number) {
    const opponent = this.ensureDuelOpponent(username);
    if (!opponent) return;

    if (typeof health === "number") {
      const wasAlive = opponent.health > 0;
      opponent.health = clamp(health, 0, 100);
      if (opponent.health <= 0) {
        if (wasAlive) this.player.kills += 1;
        opponent.state = "down";
        opponent.action?.stop();
        opponent.action = null;
        opponent.mixer = null;
        this.settleDeadEnemy(opponent, 0, true);
        return;
      }
    }

    if (!Array.isArray(position) || position.length < 3) return;
    const previous = opponent.object.position.clone();
    opponent.object.position.set(Number(position[0]) || 0, 0, Number(position[2]) || 0);
    const dx = opponent.object.position.x - previous.x;
    const dz = opponent.object.position.z - previous.z;
    const moving = dx * dx + dz * dz > 0.0009;
    if (moving) {
      opponent.object.rotation.y = Math.atan2(dx, dz);
      if (opponent.action) opponent.action.paused = false;
      opponent.cooldown = 0.2;
      opponent.state = "advance";
    } else if (opponent.action) {
      opponent.action.paused = true;
      opponent.state = "shoot";
    }
  }

  private resetAssetProgress() {
    this.loadingProgress = 0;
    this.assetProgress = {
      manifest: 0,
      city: 0,
      soldier: 0,
      weapon: 0,
    };
  }

  private reportAssetProgress(key: AssetProgressKey, progress: number, message: string) {
    this.assetProgress[key] = clamp(progress, 0, 1);
    const totalWeight = Object.values(ASSET_PROGRESS_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    const weightedProgress = (Object.keys(ASSET_PROGRESS_WEIGHTS) as AssetProgressKey[]).reduce(
      (sum, progressKey) => sum + this.assetProgress[progressKey] * ASSET_PROGRESS_WEIGHTS[progressKey],
      0,
    );
    this.loadingProgress = Math.min(99, Math.max(this.loadingProgress, Math.round((weightedProgress / totalWeight) * 100)));
    this.pushLoadingHud(message);
  }

  private reportAssetEvent(key: AssetProgressKey, event: ProgressEvent<EventTarget>, message: string) {
    const current = this.assetProgress[key];
    const progress =
      event.lengthComputable && event.total > 0
        ? Math.min(0.98, event.loaded / event.total)
        : Math.min(0.95, current + 0.025);
    this.reportAssetProgress(key, progress, message);
  }

  private async loadCity(slot: WorldSlot) {
    this.reportAssetProgress("city", 0.01, "Loading city geometry");
    const city = await new FBXLoader().loadAsync(slot.url, (event) => this.reportAssetEvent("city", event, "Loading city geometry"));
    this.reportAssetProgress("city", 1, "City geometry ready");
    city.scale.setScalar(slot.scale);
    city.position.fromArray(slot.position);
    city.rotation.set(slot.rotation[0], slot.rotation[1], slot.rotation[2]);
    city.updateMatrixWorld(true);
    city.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materialLabel = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.name).join(" ")
        : (mesh.material?.name ?? "");
      const label = `${mesh.name} ${materialLabel}`;
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      box.getSize(size);
      const isCollisionProxy = /^(ucx|ubx|ucp|usp)_/i.test(mesh.name);
      const isEditorGridSurface = /template_map_floor|procgrid|worldgrid|default.?grid|gridmaterial/i.test(label);
      const isGroundSurface =
        !isEditorGridSurface &&
        (/landscape|ground|grass|road|asphalt|pavement|sidewalk|curb|basicshape/i.test(label) ||
          (size.y < 0.9 && Math.max(size.x, size.z) > 20 && Math.min(size.x, size.z) > 0.18));
      const isHiddenHelper = isCollisionProxy || isEditorGridSurface;

      mesh.castShadow = !isHiddenHelper && !isGroundSurface;
      mesh.receiveShadow = !isHiddenHelper;
      mesh.visible = !isHiddenHelper;
      if (!isHiddenHelper) {
        mesh.material = isGroundSurface ? createGroundSurfaceMaterial(label) : createMaterialFromSource(mesh.material, mesh.name);
      }
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      if (!isEditorGridSurface) this.collisionMeshes.push(mesh);

      if (
        !isHiddenHelper &&
        !isGroundSurface &&
        size.y > 2.6 &&
        Math.max(size.x, size.z) > 1.3 &&
        Math.min(size.x, size.z) > 0.18
      ) {
        this.buildingBoxes.push(
          box
            .clone()
            .expandByVector(
              new THREE.Vector3(BUILDING_BOX_HORIZONTAL_PADDING, BUILDING_BOX_VERTICAL_PADDING, BUILDING_BOX_HORIZONTAL_PADDING),
            ),
        );
      }
    });
    this.scene.add(city);
    this.createBacklotBlockers();
  }

  private createBacklotBlockers() {
    if (this.buildingBoxes.length === 0) return;

    const bounds = new THREE.Box3();
    for (const box of this.buildingBoxes) bounds.union(box);

    const width = bounds.max.x - bounds.min.x + BACKLOT_BLOCKER_MARGIN * 2;
    const depth = bounds.max.z - bounds.min.z + BACKLOT_BLOCKER_MARGIN * 2;
    const height = BACKLOT_BLOCKER_HEIGHT;
    const y = height / 2 - 0.05;
    const xCenter = (bounds.min.x + bounds.max.x) / 2;
    const zCenter = (bounds.min.z + bounds.max.z) / 2;
    const material = new THREE.MeshStandardMaterial({
      color: "#202621",
      roughness: 0.86,
      metalness: 0.04,
      envMapIntensity: 0.22,
    });

    const addBlocker = (name: string, position: THREE.Vector3, size: THREE.Vector3) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material.clone());
      mesh.name = name;
      mesh.position.copy(position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      mesh.updateMatrixWorld(true);
      this.buildingBoxes.push(new THREE.Box3().setFromObject(mesh));
    };

    addBlocker(
      "south-backlot-blocker",
      new THREE.Vector3(xCenter, y, bounds.min.z - BACKLOT_BLOCKER_MARGIN - BACKLOT_BLOCKER_DEPTH / 2),
      new THREE.Vector3(width, height, BACKLOT_BLOCKER_DEPTH),
    );
    addBlocker(
      "north-backlot-blocker",
      new THREE.Vector3(xCenter, y, bounds.max.z + BACKLOT_BLOCKER_MARGIN + BACKLOT_BLOCKER_DEPTH / 2),
      new THREE.Vector3(width, height, BACKLOT_BLOCKER_DEPTH),
    );
    addBlocker(
      "west-backlot-blocker",
      new THREE.Vector3(bounds.min.x - BACKLOT_BLOCKER_MARGIN - BACKLOT_BLOCKER_DEPTH / 2, y, zCenter),
      new THREE.Vector3(BACKLOT_BLOCKER_DEPTH, height, depth + BACKLOT_BLOCKER_DEPTH * 2),
    );
    addBlocker(
      "east-backlot-blocker",
      new THREE.Vector3(bounds.max.x + BACKLOT_BLOCKER_MARGIN + BACKLOT_BLOCKER_DEPTH / 2, y, zCenter),
      new THREE.Vector3(BACKLOT_BLOCKER_DEPTH, height, depth + BACKLOT_BLOCKER_DEPTH * 2),
    );
  }

  private async loadSoldier(slot: SoldierSlot) {
    this.reportAssetProgress("soldier", 0.01, "Loading soldier model");
    const gltf = await new GLTFLoader().loadAsync(slot.url, (event) => this.reportAssetEvent("soldier", event, "Loading soldier model"));
    this.reportAssetProgress("soldier", 1, "Soldier model ready");
    this.soldierTemplate = gltf.scene;
    this.soldierAnimations = gltf.animations.map(createForwardLoopClip);

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const height = Math.max(0.01, box.max.y - box.min.y);
    this.soldierBaseScale = slot.scale / height;
  }

  private async loadWeapon(slot: WeaponSlot) {
    this.reportAssetProgress("weapon", 0.01, "Loading player rifle");
    const gltf = await new GLTFLoader().loadAsync(slot.url, (event) => this.reportAssetEvent("weapon", event, "Loading player rifle"));
    this.reportAssetProgress("weapon", 1, "Player rifle ready");
    this.weaponSlot = slot;
    this.weaponTemplate = gltf.scene;
    this.viewWeapon.clear();
    this.weaponMixer = null;
    for (const key of Object.keys(this.weaponActions) as WeaponAnimation[]) {
      delete this.weaponActions[key];
    }

    const model = this.createWeaponModel(slot.playerMount ?? slot, "first-person-weapon-glb", false);
    if (!model) return;
    this.viewWeapon.add(model);

    if (gltf.animations.length === 0) return;
    this.weaponMixer = new THREE.AnimationMixer(model);
    const animationNames: WeaponAnimation[] = ["idle", "fire", "reload", "throw"];
    for (const name of animationNames) {
      const configuredName = slot.animations?.[name]?.toLowerCase();
      const clip =
        gltf.animations.find((candidate) => candidate.name.toLowerCase() === configuredName) ??
        gltf.animations.find((candidate) => candidate.name.toLowerCase().includes(name));
      if (clip) this.weaponActions[name] = this.weaponMixer.clipAction(clip);
    }
    this.weaponActions.idle?.play();
  }

  private createWeaponModel(slot: TransformSlot, name: string, castShadow: boolean) {
    if (!this.weaponTemplate) return null;

    const model = cloneSkeleton(this.weaponTemplate) as THREE.Group;
    model.name = name;
    model.scale.setScalar(slot.scale);
    model.position.fromArray(slot.position);
    model.rotation.set(slot.rotation[0], slot.rotation[1], slot.rotation[2]);
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = castShadow;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => material.clone());
      } else {
        mesh.material = mesh.material.clone();
      }
    });
    return model;
  }

  private createFlag() {
    const cols = 34;
    const rows = 20;
    const width = 18;
    const height = 9;
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    for (let y = 0; y <= rows; y += 1) {
      for (let x = 0; x <= cols; x += 1) {
        const px = (x / cols) * width;
        const py = height / 2 - (y / rows) * height;
        vertices.push(px, py, 0);

        const bandX = x / cols;
        const bandY = y / rows;
        const color =
          bandX < 0.24
            ? new THREE.Color("#e11d2e")
            : bandY < 0.333
              ? new THREE.Color("#009a44")
              : bandY < 0.666
                ? new THREE.Color("#f7f7f2")
                : new THREE.Color("#111111");
        colors.push(color.r, color.g, color.b);
      }
    }

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const a = y * (cols + 1) + x;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(vertices);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.72,
      metalness: 0.02,
    });
    const flag = new THREE.Mesh(geometry, material);
    flag.castShadow = true;
    flag.receiveShadow = true;
    flag.position.set(-28, 36, -58);
    flag.rotation.y = -0.28;

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.2, 42, 28),
      new THREE.MeshStandardMaterial({ color: "#d4d7d2", roughness: 0.28, metalness: 0.78 }),
    );
    pole.position.set(-28, 18, -58);
    pole.castShadow = true;

    this.scene.add(pole, flag);
    this.flag = {
      geometry,
      positions,
      previous: new Float32Array(vertices),
      original: new Float32Array(vertices),
      cols,
      rows,
      restX: width / cols,
      restY: height / rows,
    };
  }

  private spawnEnemies() {
    if (!this.manifest || !this.soldierTemplate) return;
    for (const enemy of this.enemies) this.scene.remove(enemy.object);
    this.enemies.length = 0;

    const level = this.currentLevel;
    const spawnPoints = Array.from({ length: level.enemyCount }, (_, index) => {
      const angle = index * 2.399 + level.difficulty * 0.4;
      const radius = level.enemyRadius * (0.56 + (index % 4) * 0.13);
      const candidate = new THREE.Vector3(
        level.playerSpawn[0] + Math.cos(angle) * radius,
        0,
        level.playerSpawn[2] + Math.sin(angle) * radius,
      );
      return this.findClearPosition(candidate, 14).setY(0);
    });

    spawnPoints.forEach((position, index) => {
      const variant = this.manifest!.enemyVariants[index % this.manifest!.enemyVariants.length];
      const object = this.instantiateSoldier(variant, position, index);
      if (!object) return;
      this.scene.add(object.group);
      this.enemies.push({
        id: `${variant.id}-${index}`,
        variant,
        object: object.group,
        mixer: object.mixer,
        action: object.action,
        health: variant.health * level.difficulty,
        armor: variant.armor * level.difficulty,
        state: "patrol",
        cooldown: 2.2 + index * 0.22,
        bombCooldown: 9 + index,
        patrolAngle: Math.random() * Math.PI * 2,
        deathPoseApplied: false,
      });
    });
  }

  private ensureDuelOpponent(username: string) {
    if (!this.manifest || !this.soldierTemplate) return null;
    const existing = this.enemies[0];
    if (existing) return existing;

    const base = this.manifest.enemyVariants.find((variant) => variant.role === "commander") ?? this.manifest.enemyVariants[0];
    if (!base) return null;
    const variant: EnemyVariant = {
      ...base,
      id: "friend-duel-rival",
      displayName: username || this.duelOpponent || "Friend Rival",
      role: "commander",
      health: 100,
      armor: 0,
      damage: 0,
      speed: 0,
      scale: 1.04,
    };
    const position = new THREE.Vector3(this.player.position.x, 0, this.player.position.z - 10);
    const object = this.instantiateSoldier(variant, position, 0);
    if (!object) return null;

    if (object.action) object.action.paused = true;
    this.scene.add(object.group);
    const opponent: EnemyRuntime = {
      id: `duel-${username || "friend"}`,
      variant,
      object: object.group,
      mixer: object.mixer,
      action: object.action,
      health: 100,
      armor: 0,
      state: "shoot",
      cooldown: Number.POSITIVE_INFINITY,
      bombCooldown: Number.POSITIVE_INFINITY,
      patrolAngle: Math.random() * Math.PI * 2,
      deathPoseApplied: false,
    };
    this.enemies.push(opponent);
    return opponent;
  }

  private instantiateSoldier(variant: EnemyVariant, position: THREE.Vector3, index: number) {
    if (!this.soldierTemplate) return null;

    const model = cloneSkeleton(this.soldierTemplate) as THREE.Group;
    model.name = variant.id;
    model.scale.setScalar(this.soldierBaseScale * variant.scale);
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => material.clone());
      } else {
        mesh.material = mesh.material.clone();
      }
    });

    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    model.position.set(-centerX, -box.min.y, -centerZ);

    const group = new THREE.Group();
    group.name = variant.id;
    group.position.copy(position);
    group.rotation.y = Math.PI + index * 0.2;
    group.add(model);

    const mixer = this.soldierAnimations.length > 0 ? new THREE.AnimationMixer(model) : null;
    const action = mixer ? mixer.clipAction(this.soldierAnimations[0]) : null;
    if (action) {
      action.enabled = true;
      action.clampWhenFinished = false;
      action.zeroSlopeAtStart = true;
      action.zeroSlopeAtEnd = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = 1;
      action.time = (index * 0.37) % action.getClip().duration;
      action.fadeIn(0.18).play();
    }

    return { group, mixer, action };
  }

  private clearCombatEffects() {
    for (const projectile of this.projectiles) this.scene.remove(projectile.mesh);
    for (const trace of this.traces) this.scene.remove(trace.line);
    this.projectiles.length = 0;
    this.traces.length = 0;
  }

  private resetSolo() {
    if (!this.manifest) return;
    this.clearCombatEffects();
    this.paused = false;
    this.missionComplete = false;
    this.player.position.fromArray(this.currentLevel.playerSpawn);
    if (this.isInsideBuilding(this.player.position)) {
      this.player.position.copy(this.findClearPosition(this.player.position, 18));
    }
    this.pointer.yaw = this.manifest.spawn.player.rotation[1];
    this.pointer.pitch = 0;
    this.player.health = 100;
    this.player.armor = 100;
    this.player.stamina = 100;
    this.player.ammo = 30;
    this.player.reserve = 120;
    this.player.kills = 0;
    this.player.reloadTimer = 0;
    this.player.bombCooldown = 0;
    this.player.damageCooldown = 0;
    this.player.graceTimer = 10;
    this.keys.clear();
    this.touchMove.set(0, 0);
    this.spawnEnemies();
  }

  private resetDuel() {
    if (!this.manifest) return;
    this.clearCombatEffects();
    for (const enemy of this.enemies) this.scene.remove(enemy.object);
    this.enemies.length = 0;
    this.paused = false;
    this.missionComplete = false;
    this.player.position.fromArray([0, 1.7, 12]);
    if (this.isInsideBuilding(this.player.position)) {
      this.player.position.copy(this.findClearPosition(this.player.position, 18));
    }
    this.pointer.yaw = this.manifest.spawn.player.rotation[1];
    this.pointer.pitch = 0;
    this.player.health = 100;
    this.player.armor = 100;
    this.player.stamina = 100;
    this.player.ammo = 30;
    this.player.reserve = 120;
    this.player.kills = 0;
    this.player.reloadTimer = 0;
    this.player.bombCooldown = 0;
    this.player.damageCooldown = 0;
    this.player.graceTimer = 3;
    this.keys.clear();
    this.touchMove.set(0, 0);
    this.duelSyncTimer = 0;
    this.sendDuelState();
  }

  private animate = () => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.fps = THREE.MathUtils.lerp(this.fps, 1 / Math.max(delta, 0.001), 0.08);
    this.update(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private update(delta: number) {
    this.updateFlag(delta);

    if (this.paused) {
      if (performance.now() - this.lastHud > 120) this.pushHud("Mission paused", false);
      return;
    }

    if (this.missionComplete) {
      this.updateViewWeapon(delta);
      if (performance.now() - this.lastHud > 120) this.pushHud("Mission complete", false);
      return;
    }

    this.updateCamera(delta);
    this.updateViewWeapon(delta);
    this.updateEnemies(delta);
    this.resolveEnemyEnemyCollisions();
    this.resolvePlayerEnemyCollisions();
    this.updateDuelNetwork(delta);
    this.updateProjectiles(delta);
    this.updateTraces(delta);

    if (this.player.reloadTimer > 0) {
      this.player.reloadTimer -= delta;
      if (this.player.reloadTimer <= 0) {
        const needed = 30 - this.player.ammo;
        const loaded = Math.min(needed, this.player.reserve);
        this.player.ammo += loaded;
        this.player.reserve -= loaded;
      }
    }
    this.player.shotCooldown = Math.max(0, this.player.shotCooldown - delta);
    this.player.bombCooldown = Math.max(0, this.player.bombCooldown - delta);
    this.player.damageCooldown = Math.max(0, this.player.damageCooldown - delta);
    this.player.graceTimer = Math.max(0, this.player.graceTimer - delta);

    if (this.active && this.player.health > 0 && !this.missionComplete && this.enemies.length > 0 && this.activeEnemyCount() === 0) {
      this.missionComplete = true;
      this.touchMove.set(0, 0);
      this.keys.clear();
      if (document.pointerLockElement === this.renderer.domElement) void document.exitPointerLock();
      this.pushHud("Mission complete", false);
      return;
    }

    if (performance.now() - this.lastHud > 120) {
      const message = this.missionComplete
        ? this.combatMode === "duel"
          ? "1v1 duel won"
          : "Mission complete"
        : this.active
          ? this.combatMode === "duel"
            ? `1v1 duel live: ${this.duelOpponent || "Friend"}`
            : "Solo AI operation active"
          : "UAE War City standby";
      this.pushHud(message, false);
    }
  }

  private updateCamera(delta: number) {
    if (this.active && this.player.health > 0) {
      const forward = Number(this.keys.has("KeyW")) - Number(this.keys.has("KeyS")) + this.touchMove.y;
      const side = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA")) + this.touchMove.x;
      const direction = new THREE.Vector3(side, 0, -forward);
      const moving = direction.lengthSq() > 0.001;
      const wantsSprint =
        moving &&
        (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || Math.hypot(this.touchMove.x, this.touchMove.y) > 0.92);
      const sprinting = wantsSprint && this.player.stamina > 5;
      const speed = sprinting ? 8.4 : 5.45;
      this.player.stamina = clamp(this.player.stamina + (sprinting ? -28 : 18) * delta, 0, 100);
      if (direction.lengthSq() > 0) {
        direction.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.pointer.yaw);
        const next = this.player.position.clone().addScaledVector(direction, speed * delta);
        if (
          this.canMoveTo(this.player.position, next, {
            blockEnemies: true,
            colliderRadius: PLAYER_BODY_RADIUS,
            buildingRadius: PLAYER_BUILDING_RADIUS,
          })
        ) {
          this.player.position.copy(next);
        }
      }
    } else {
      this.pointer.yaw += delta * 0.035;
    }

    this.camera.position.copy(this.player.position);
    this.camera.rotation.y = this.pointer.yaw;
    this.camera.rotation.x = this.pointer.pitch;
  }

  private updateViewWeapon(delta: number) {
    this.weaponMixer?.update(delta);
    const moving =
      this.active &&
      !this.paused &&
      !this.missionComplete &&
      this.player.health > 0 &&
      (this.touchMove.lengthSq() > 0.04 ||
        this.keys.has("KeyW") ||
        this.keys.has("KeyA") ||
        this.keys.has("KeyS") ||
        this.keys.has("KeyD"));
    const t = this.clock.elapsedTime;
    const bob = moving ? Math.sin(t * 8.5) : 0;
    const targetPosition = this.weaponRest.position.clone().add(new THREE.Vector3(bob * 0.018, Math.abs(bob) * 0.014, 0));
    this.viewWeapon.position.lerp(targetPosition, 1 - Math.exp(-delta * 9));
    this.viewWeapon.rotation.x = THREE.MathUtils.lerp(this.viewWeapon.rotation.x, this.weaponRest.rotation.x + bob * 0.012, 1 - Math.exp(-delta * 10));
    this.viewWeapon.rotation.y = THREE.MathUtils.lerp(this.viewWeapon.rotation.y, this.weaponRest.rotation.y, 1 - Math.exp(-delta * 8));
    this.viewWeapon.rotation.z = THREE.MathUtils.lerp(this.viewWeapon.rotation.z, this.weaponRest.rotation.z + bob * 0.01, 1 - Math.exp(-delta * 8));
  }

  private playWeaponAction(name: WeaponAnimation) {
    const action = this.weaponActions[name];
    if (!action) return;
    if (name !== "idle") {
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
    }
    action.fadeIn(0.03).play();
  }

  private activeEnemyCount() {
    return this.enemies.filter((enemy) => enemy.health > 0).length;
  }

  private isInsideBuilding(point: THREE.Vector3, radius = 0) {
    const y = point.y > 0.25 ? point.y : 1.15;
    return this.buildingBoxes.some(
      (box) =>
        y >= box.min.y - 0.45 &&
        y <= box.max.y + 0.9 &&
        point.x >= box.min.x - radius &&
        point.x <= box.max.x + radius &&
        point.z >= box.min.z - radius &&
        point.z <= box.max.z + radius,
    );
  }

  private findClearPosition(origin: THREE.Vector3, radius: number) {
    if (!this.isInsideBuilding(origin)) return origin.clone();
    for (let ring = 1; ring <= 8; ring += 1) {
      const samples = 10 + ring * 4;
      for (let i = 0; i < samples; i += 1) {
        const angle = i * 2.399 + ring * 0.61;
        const candidate = new THREE.Vector3(
          origin.x + Math.cos(angle) * radius * ring * 0.16,
          origin.y,
          origin.z + Math.sin(angle) * radius * ring * 0.16,
        );
        if (!this.isInsideBuilding(candidate, 0.45)) return candidate;
      }
    }
    return origin.clone();
  }

  private enemyColliderRadius(enemy: EnemyRuntime) {
    return enemy.health <= 0 || enemy.state === "down" ? ENEMY_DEAD_BODY_RADIUS : ENEMY_BODY_RADIUS;
  }

  private isInsideEnemyBody(point: THREE.Vector3, radius = 0, ignoredEnemy?: EnemyRuntime) {
    return this.enemies.some((enemy) => {
      if (enemy === ignoredEnemy) return false;
      const blockedDistance = this.enemyColliderRadius(enemy) + radius;
      const blockedDistanceSq = blockedDistance * blockedDistance;
      const dx = point.x - enemy.object.position.x;
      const dz = point.z - enemy.object.position.z;
      return dx * dx + dz * dz < blockedDistanceSq;
    });
  }

  private resolveEnemyEnemyCollisions() {
    for (let pass = 0; pass < 2; pass += 1) {
      let corrected = false;
      for (let i = 0; i < this.enemies.length; i += 1) {
        const first = this.enemies[i];
        for (let j = i + 1; j < this.enemies.length; j += 1) {
          const second = this.enemies[j];
          const firstDead = first.health <= 0 || first.state === "down";
          const secondDead = second.health <= 0 || second.state === "down";
          if (firstDead && secondDead) continue;

          const minDistance = this.enemyColliderRadius(first) + this.enemyColliderRadius(second);
          const dx = second.object.position.x - first.object.position.x;
          const dz = second.object.position.z - first.object.position.z;
          const distanceSq = dx * dx + dz * dz;
          if (distanceSq >= minDistance * minDistance) continue;

          const distance = Math.sqrt(Math.max(distanceSq, 0.0001));
          const overlap = minDistance - distance;
          const pushX = dx / distance;
          const pushZ = dz / distance;
          const firstShare = firstDead ? 0 : secondDead ? 1 : 0.5;
          const secondShare = secondDead ? 0 : firstDead ? 1 : 0.5;

          if (firstShare > 0) {
            const candidate = first.object.position.clone();
            candidate.x -= pushX * overlap * firstShare;
            candidate.z -= pushZ * overlap * firstShare;
            if (!this.isInsideBuilding(candidate, ENEMY_BUILDING_RADIUS)) {
              first.object.position.x = candidate.x;
              first.object.position.z = candidate.z;
              corrected = true;
            }
          }

          if (secondShare > 0) {
            const candidate = second.object.position.clone();
            candidate.x += pushX * overlap * secondShare;
            candidate.z += pushZ * overlap * secondShare;
            if (!this.isInsideBuilding(candidate, ENEMY_BUILDING_RADIUS)) {
              second.object.position.x = candidate.x;
              second.object.position.z = candidate.z;
              corrected = true;
            }
          }
        }
      }
      if (!corrected) break;
    }
  }

  private resolvePlayerEnemyCollisions() {
    if (!this.active || this.player.health <= 0) return;

    for (let pass = 0; pass < 3; pass += 1) {
      let corrected = false;
      for (const enemy of this.enemies) {
        const blockedDistance = this.enemyColliderRadius(enemy) + PLAYER_BODY_RADIUS;
        const dx = this.player.position.x - enemy.object.position.x;
        const dz = this.player.position.z - enemy.object.position.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= blockedDistance * blockedDistance) continue;

        const distance = Math.sqrt(Math.max(distanceSq, 0.0001));
        const pushDirection =
          distance > 0.01
            ? new THREE.Vector3(dx / distance, 0, dz / distance)
            : new THREE.Vector3(Math.sin(this.pointer.yaw), 0, Math.cos(this.pointer.yaw));
        const candidate = new THREE.Vector3(
          enemy.object.position.x + pushDirection.x * blockedDistance,
          this.player.position.y,
          enemy.object.position.z + pushDirection.z * blockedDistance,
        );

        if (!this.isInsideBuilding(candidate, PLAYER_BUILDING_RADIUS)) {
          this.player.position.x = candidate.x;
          this.player.position.z = candidate.z;
          corrected = true;
        }
      }
      if (!corrected) break;
    }
  }

  private canMoveTo(
    from: THREE.Vector3,
    to: THREE.Vector3,
    options: { blockEnemies?: boolean; colliderRadius?: number; buildingRadius?: number; ignoredEnemy?: EnemyRuntime } = {},
  ) {
    const distance = from.distanceTo(to);
    if (distance < 0.001) return true;
    const steps = Math.max(1, Math.ceil(distance / 0.34));
    const probe = new THREE.Vector3();
    const colliderRadius = options.colliderRadius ?? 0.38;
    const buildingRadius = options.buildingRadius ?? colliderRadius;
    for (let step = 1; step <= steps; step += 1) {
      probe.lerpVectors(from, to, step / steps);
      probe.y = 1.15;
      if (this.isInsideBuilding(probe, buildingRadius)) return false;
      if (options.blockEnemies && this.isInsideEnemyBody(probe, colliderRadius, options.ignoredEnemy)) {
        return false;
      }
    }
    return true;
  }

  private hasLineOfSight(enemy: EnemyRuntime, distance: number) {
    const start = enemy.object.position.clone().add(new THREE.Vector3(0, 1.35, 0));
    const end = this.player.position.clone().setY(1.45);
    const direction = end.sub(start).normalize();
    this.raycaster.set(start, direction);
    this.raycaster.far = distance - 0.55;
    const hit = new THREE.Vector3();
    return !this.buildingBoxes.some((box) => {
      if (box.max.y < 0.7) return false;
      const intersection = this.raycaster.ray.intersectBox(box, hit);
      return intersection ? start.distanceTo(intersection) < distance - 0.7 : false;
    });
  }

  private applyDeadEnemyPose(enemy: EnemyRuntime) {
    if (enemy.deathPoseApplied) return;
    enemy.deathPoseApplied = true;
    enemy.object.traverse((child) => {
      const mesh = child as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) mesh.skeleton.pose();
    });
  }

  private settleDeadEnemy(enemy: EnemyRuntime, delta: number, immediate = false) {
    this.applyDeadEnemyPose(enemy);
    const blend = immediate ? 1 : 1 - Math.exp(-delta * 8);
    enemy.object.rotation.x = THREE.MathUtils.lerp(enemy.object.rotation.x, ENEMY_DEATH_FACE_UP_PITCH, blend);
    enemy.object.rotation.z = THREE.MathUtils.lerp(enemy.object.rotation.z, 0, blend);
    enemy.object.position.y = THREE.MathUtils.lerp(enemy.object.position.y, 0, blend);

    enemy.object.updateMatrixWorld(true);
    const deathBox = new THREE.Box3().setFromObject(enemy.object);
    const neededLift = Math.max(0, ENEMY_DEATH_GROUND_CLEARANCE - deathBox.min.y);
    enemy.object.position.y = Math.min(ENEMY_DEATH_MAX_LIFT, enemy.object.position.y + neededLift);
  }

  private updateEnemies(delta: number) {
    if (this.combatMode === "duel") {
      for (const enemy of this.enemies) {
        if (enemy.health <= 0) {
          if (enemy.state !== "down") {
            enemy.state = "down";
            enemy.action?.stop();
            enemy.action = null;
            enemy.mixer = null;
          }
          this.settleDeadEnemy(enemy, delta);
          continue;
        }

        if (enemy.action && enemy.cooldown <= 0) enemy.action.paused = true;
        if (enemy.action && !enemy.action.paused) enemy.mixer?.update(delta);
        enemy.cooldown = Math.max(0, enemy.cooldown - delta);
      }
      return;
    }

    const playerGround = new THREE.Vector3(this.player.position.x, 0, this.player.position.z);

    for (const enemy of this.enemies) {
      if (enemy.health <= 0) {
        if (enemy.state !== "down") {
          enemy.state = "down";
          enemy.action?.stop();
          enemy.action = null;
          enemy.mixer = null;
          enemy.cooldown = Number.POSITIVE_INFINITY;
          enemy.bombCooldown = Number.POSITIVE_INFINITY;
        }
        this.settleDeadEnemy(enemy, delta);
        continue;
      }

      if (!this.active || this.player.health <= 0) {
        enemy.state = "patrol";
        if (enemy.action) enemy.action.paused = true;
        enemy.patrolAngle += delta * 0.18;
        enemy.object.rotation.y += Math.sin(enemy.patrolAngle) * delta * 0.08;
        continue;
      }

      const toPlayer = playerGround.clone().sub(enemy.object.position);
      const distance = Math.max(0.01, toPlayer.length());
      const direction = toPlayer.normalize();
      enemy.object.rotation.y = THREE.MathUtils.lerp(
        enemy.object.rotation.y,
        Math.atan2(direction.x, direction.z),
        delta * 5,
      );
      enemy.cooldown -= delta;
      enemy.bombCooldown -= delta;
      let movedThisFrame = false;

      const canAttack = this.player.graceTimer <= 0 && this.hasLineOfSight(enemy, distance);
      const shouldAdvance = distance > ENEMY_STOP_DISTANCE;
      if (shouldAdvance) {
        enemy.state = "advance";
        const step = Math.min(enemy.variant.speed * delta, distance - ENEMY_STOP_DISTANCE);
        if (step > 0.001) {
          const next = enemy.object.position.clone().addScaledVector(direction, step);
          if (
            this.canMoveTo(enemy.object.position.clone().setY(1.1), next.clone().setY(1.1), {
              blockEnemies: true,
              colliderRadius: ENEMY_BODY_RADIUS,
              buildingRadius: ENEMY_BUILDING_RADIUS,
              ignoredEnemy: enemy,
            })
          ) {
            enemy.object.position.copy(next);
            movedThisFrame = true;
          }
        }
      } else {
        enemy.state = enemy.variant.role === "heavy" && enemy.bombCooldown <= 0 ? "throw" : "shoot";
        if (enemy.state === "throw") {
          this.throwEnemyBomb(enemy);
          enemy.bombCooldown = 7.5;
        }
        if (canAttack && enemy.cooldown <= 0) {
          this.damagePlayer(enemy.variant.damage);
          this.createTrace(enemy.object.position.clone().add(new THREE.Vector3(0, 1.4, 0)), this.player.position.clone(), "#ff6b45");
          enemy.cooldown = enemy.variant.role === "sniper" ? 2.15 : enemy.variant.role === "heavy" ? 1.85 : 1.35;
        }
      }

      if (enemy.action) enemy.action.paused = !movedThisFrame;
      if (movedThisFrame) enemy.mixer?.update(delta);
    }
  }

  private updateProjectiles(delta: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      projectile.life -= delta;
      projectile.velocity.y -= 9.8 * delta;
      projectile.mesh.position.addScaledVector(projectile.velocity, delta);
      projectile.mesh.rotation.x += delta * 7;
      projectile.mesh.rotation.z += delta * 4;

      const hitGround = projectile.mesh.position.y <= 0.18;
      const hitPlayer =
        projectile.owner === "enemy" &&
        projectile.mesh.position.distanceTo(this.player.position) < 1.8;
      if (hitGround || hitPlayer || projectile.life <= 0) {
        this.explode(projectile.mesh.position.clone(), projectile.owner);
        this.scene.remove(projectile.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private updateTraces(delta: number) {
    for (let i = this.traces.length - 1; i >= 0; i -= 1) {
      const trace = this.traces[i];
      trace.life -= delta;
      const material = trace.line.material as THREE.LineBasicMaterial;
      material.opacity = clamp(trace.life / 0.18, 0, 1);
      if (trace.life <= 0) {
        this.scene.remove(trace.line);
        this.traces.splice(i, 1);
      }
    }
  }

  private updateFlag(delta: number) {
    if (!this.flag) return;
    const { positions, previous, original, cols, rows, restX, restY } = this.flag;
    const time = performance.now() * 0.001;
    const dt = Math.min(delta, 0.033);

    for (let y = 0; y <= rows; y += 1) {
      for (let x = 0; x <= cols; x += 1) {
        const index = (y * (cols + 1) + x) * 3;
        if (x === 0) {
          positions[index] = original[index];
          positions[index + 1] = original[index + 1];
          positions[index + 2] = original[index + 2];
          previous[index] = positions[index];
          previous[index + 1] = positions[index + 1];
          previous[index + 2] = positions[index + 2];
          continue;
        }

        const px = positions[index];
        const py = positions[index + 1];
        const pz = positions[index + 2];
        const vx = (px - previous[index]) * 0.985;
        const vy = (py - previous[index + 1]) * 0.985;
        const vz = (pz - previous[index + 2]) * 0.985;
        previous[index] = px;
        previous[index + 1] = py;
        previous[index + 2] = pz;

        const wind = Math.sin(time * 2.4 + x * 0.36 + y * 0.18) * 8.5 + 7;
        positions[index] = px + vx;
        positions[index + 1] = py + vy - 0.22 * dt * dt;
        positions[index + 2] = pz + vz + wind * dt * dt;
      }
    }

    const satisfy = (a: number, b: number, rest: number) => {
      const ax = a * 3;
      const bx = b * 3;
      const dx = positions[bx] - positions[ax];
      const dy = positions[bx + 1] - positions[ax + 1];
      const dz = positions[bx + 2] - positions[ax + 2];
      const distance = Math.max(0.0001, Math.hypot(dx, dy, dz));
      const correction = (distance - rest) / distance / 2;
      const cx = dx * correction;
      const cy = dy * correction;
      const cz = dz * correction;
      if (a % (cols + 1) !== 0) {
        positions[ax] += cx;
        positions[ax + 1] += cy;
        positions[ax + 2] += cz;
      }
      if (b % (cols + 1) !== 0) {
        positions[bx] -= cx;
        positions[bx + 1] -= cy;
        positions[bx + 2] -= cz;
      }
    };

    for (let pass = 0; pass < 3; pass += 1) {
      for (let y = 0; y <= rows; y += 1) {
        for (let x = 0; x <= cols; x += 1) {
          const id = y * (cols + 1) + x;
          if (x < cols) satisfy(id, id + 1, restX);
          if (y < rows) satisfy(id, id + cols + 1, restY);
        }
      }
    }

    const attr = this.flag.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.flag.geometry.computeVertexNormals();
  }

  private tryShoot() {
    if (
      !this.active ||
      this.paused ||
      this.missionComplete ||
      this.player.shotCooldown > 0 ||
      this.player.reloadTimer > 0 ||
      this.player.health <= 0
    ) {
      return;
    }
    if (this.player.ammo <= 0) {
      this.startReload();
      return;
    }

    this.player.ammo -= 1;
    this.player.shotCooldown = 0.105;
    this.viewWeapon.position.z += 0.09;
    this.viewWeapon.rotation.x -= 0.045;
    this.playWeaponAction("fire");

    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    this.raycaster.set(origin, direction);
    this.raycaster.far = 180;

    let best: { enemy: EnemyRuntime; distance: number } | null = null;
    for (const enemy of this.enemies) {
      if (enemy.health <= 0) continue;
      const box = new THREE.Box3().setFromObject(enemy.object).expandByScalar(0.18);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectBox(box, hit)) {
        const distance = origin.distanceTo(hit);
        if (!best || distance < best.distance) best = { enemy, distance };
      }
    }

    const end = origin.clone().addScaledVector(direction, best?.distance ?? 80);
    this.createTrace(origin.clone().addScaledVector(direction, 0.9), end, "#78ffad");

    if (best) {
      if (this.combatMode === "duel") {
        const amount = 24;
        best.enemy.health = Math.max(1, best.enemy.health - 4);
        best.enemy.state = "shoot";
        this.sendDuelMessage({ type: "duel_hit", amount });
      } else {
        this.damageEnemy(best.enemy, 42);
      }
    }
  }

  private startReload() {
    if (!this.active || this.paused || this.missionComplete || this.player.reloadTimer > 0 || this.player.ammo >= 30 || this.player.reserve <= 0) return;
    this.player.reloadTimer = 1.65;
    this.playWeaponAction("reload");
  }

  private damageEnemy(enemy: EnemyRuntime, amount: number) {
    const armorHit = Math.min(enemy.armor, amount * 0.35);
    enemy.armor -= armorHit;
    enemy.health -= amount - armorHit;
    enemy.state = "shoot";
    if (enemy.health <= 0) {
      enemy.health = 0;
      this.player.kills += 1;
      enemy.state = "down";
      enemy.action?.stop();
      enemy.action = null;
      enemy.mixer = null;
      enemy.cooldown = Number.POSITIVE_INFINITY;
      enemy.bombCooldown = Number.POSITIVE_INFINITY;
      this.settleDeadEnemy(enemy, 0, true);
    }
  }

  private damagePlayer(amount: number) {
    if (this.player.health <= 0 || this.player.graceTimer > 0 || this.player.damageCooldown > 0) return;
    this.player.damageCooldown = this.combatMode === "duel" ? 0.22 : 0.95;
    const tunedAmount = amount * (this.combatMode === "duel" ? 0.7 : 0.42);
    const armorHit = Math.min(this.player.armor, tunedAmount * 0.55);
    this.player.armor -= armorHit;
    this.player.health = Math.max(0, this.player.health - (tunedAmount - armorHit));
    if (this.player.health <= 0) {
      this.touchMove.set(0, 0);
      this.pushHud("Killed in action", false);
    }
    if (this.combatMode === "duel") this.sendDuelState();
  }

  private throwPlayerBomb() {
    if (!this.active || this.paused || this.missionComplete || this.player.bombCooldown > 0 || this.player.health <= 0) return;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const mesh = this.createBombMesh("#70ffa3");
    mesh.position.copy(this.player.position).addScaledVector(direction, 1.2).add(new THREE.Vector3(0, -0.25, 0));
    this.scene.add(mesh);
    this.viewWeapon.position.y -= 0.08;
    this.viewWeapon.rotation.z -= 0.18;
    this.playWeaponAction("throw");
    this.projectiles.push({
      mesh,
      velocity: direction.multiplyScalar(17).add(new THREE.Vector3(0, 6.4, 0)),
      life: 3.2,
      owner: "player",
    });
    this.player.bombCooldown = 4.5;
  }

  private throwEnemyBomb(enemy: EnemyRuntime) {
    const target = this.player.position.clone();
    const start = enemy.object.position.clone().add(new THREE.Vector3(0, 1.35, 0));
    const direction = target.sub(start);
    const distance = Math.max(1, direction.length());
    direction.normalize();
    const mesh = this.createBombMesh("#ff7b45");
    mesh.position.copy(start);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      velocity: direction.multiplyScalar(Math.min(15, distance * 0.72)).add(new THREE.Vector3(0, 6.2, 0)),
      life: 3.4,
      owner: "enemy",
    });
  }

  private createBombMesh(color: string) {
    return new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 18, 12),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.7,
        roughness: 0.28,
        metalness: 0.35,
      }),
    );
  }

  private explode(position: THREE.Vector3, owner: "player" | "enemy") {
    const ring = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 24, 16),
      new THREE.MeshBasicMaterial({
        color: owner === "player" ? "#8dffb4" : "#ff875f",
        transparent: true,
        opacity: 0.45,
        wireframe: true,
      }),
    );
    ring.position.copy(position);
    this.scene.add(ring);
    this.traces.push({ line: ring as unknown as THREE.Line, life: 0.3 });

    if (owner === "player") {
      for (const enemy of this.enemies) {
        if (enemy.health <= 0) continue;
        const distance = enemy.object.position.distanceTo(position);
        if (distance < 5.4) this.damageEnemy(enemy, (1 - distance / 5.4) * 120);
      }
    } else if (this.player.position.distanceTo(position) < 4.8) {
      this.damagePlayer(38);
    }
  }

  private createTrace(start: THREE.Vector3, end: THREE.Vector3, color: string) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.traces.push({ line, life: 0.18 });
  }

  private hudSnapshot(message: string, loading: boolean): HudSnapshot {
    const gameOver = this.player.health <= 0 && this.active;
    const missionComplete = this.missionComplete && this.active && !gameOver;
    return {
      loading,
      loadingProgress: loading ? this.loadingProgress : 100,
      message,
      health: Math.round(this.player.health),
      armor: Math.round(this.player.armor),
      stamina: Math.round(this.player.stamina),
      ammo: this.player.ammo,
      reserve: this.player.reserve,
      enemies: this.activeEnemyCount(),
      mode: this.active ? (this.combatMode === "duel" ? "duel" : "solo") : "ambient",
      kills: this.player.kills,
      fps: Math.round(this.fps),
      levelName: this.combatMode === "duel" ? `1v1 vs ${this.duelOpponent || "Friend"}` : this.currentLevel.name,
      gameOver,
      missionComplete,
      paused: this.paused && this.active && !gameOver && !missionComplete,
    };
  }

  private pushLoadingHud(message: string) {
    this.lastHud = performance.now();
    this.onHud(this.hudSnapshot(message, true));
  }

  private pushHud(message: string, loading: boolean) {
    this.lastHud = performance.now();
    this.onHud(this.hudSnapshot(message, loading));
  }
}

function GameCanvas({
  combatMode,
  duelOpponent,
  duelMissionId,
  sessionToken,
  playerName,
  levelId,
  onHud,
  onEngineReady,
}: {
  combatMode: CombatMode;
  duelOpponent: string;
  duelMissionId: string;
  sessionToken: string;
  playerName: string;
  levelId: string;
  onHud: (snapshot: HudSnapshot) => void;
  onEngineReady: (engine: FrontlineEngine | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<FrontlineEngine | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const engine = new FrontlineEngine(hostRef.current, onHud);
    engineRef.current = engine;
    onEngineReady(engine);
    engine.setLevel(levelId);
    engine.init();
    return () => {
      engine.dispose();
      engineRef.current = null;
      onEngineReady(null);
    };
  }, [onEngineReady, onHud]);

  useEffect(() => {
    if (combatMode === "duel") {
      if (duelMissionId && sessionToken) {
        engineRef.current?.startDuel(duelOpponent, duelMissionId, sessionToken, playerName || "player");
      }
    } else {
      engineRef.current?.setSoloActive(combatMode === "solo");
    }
  }, [combatMode, duelMissionId, duelOpponent, playerName, sessionToken]);

  useEffect(() => {
    engineRef.current?.setLevel(levelId);
  }, [levelId]);

  return <div className="scene-host" ref={hostRef} />;
}

function TouchControls({
  soloActive,
  engineRef,
}: {
  soloActive: boolean;
  engineRef: MutableRefObject<FrontlineEngine | null>;
}) {
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const movePointer = useRef<number | null>(null);
  const lookPointer = useRef<number | null>(null);
  const lookStart = useRef({ x: 0, y: 0 });
  const radius = 52;

  useEffect(() => {
    if (!soloActive) {
      setStick({ x: 0, y: 0 });
      engineRef.current?.setTouchMove(0, 0);
    }
  }, [engineRef, soloActive]);

  if (!soloActive) return null;

  function updateStick(target: EventTarget & HTMLDivElement, clientX: number, clientY: number) {
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const rawX = clientX - centerX;
    const rawY = clientY - centerY;
    const length = Math.min(radius, Math.hypot(rawX, rawY));
    const angle = Math.atan2(rawY, rawX);
    const x = Math.cos(angle) * length;
    const y = Math.sin(angle) * length;
    setStick({ x, y });
    engineRef.current?.setTouchMove(x / radius, -y / radius);
  }

  function resetStick() {
    movePointer.current = null;
    setStick({ x: 0, y: 0 });
    engineRef.current?.setTouchMove(0, 0);
  }

  return (
    <section className="touch-layer" aria-label="Touch controls">
      <div
        className="touch-joystick"
        onPointerCancel={resetStick}
        onPointerDown={(event) => {
          movePointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateStick(event.currentTarget, event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (movePointer.current === event.pointerId) updateStick(event.currentTarget, event.clientX, event.clientY);
        }}
        onPointerUp={resetStick}
      >
        <span style={{ transform: `translate(calc(-50% + ${stick.x}px), calc(-50% + ${stick.y}px))` }} />
      </div>

      <div
        className="touch-look"
        onPointerCancel={() => {
          lookPointer.current = null;
        }}
        onPointerDown={(event) => {
          lookPointer.current = event.pointerId;
          lookStart.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (lookPointer.current !== event.pointerId) return;
          const dx = event.clientX - lookStart.current.x;
          const dy = event.clientY - lookStart.current.y;
          lookStart.current = { x: event.clientX, y: event.clientY };
          engineRef.current?.pushTouchLook(dx, dy);
        }}
        onPointerUp={() => {
          lookPointer.current = null;
        }}
      />

      <div className="touch-actions">
        <button type="button" aria-label="Reload" onClick={() => engineRef.current?.reload()}>
          <RotateCcw size={20} />
        </button>
        <button type="button" aria-label="Throw bomb" onClick={() => engineRef.current?.throwBomb()}>
          <Bomb size={20} />
        </button>
        <button className="fire-touch" type="button" aria-label="Fire" onPointerDown={() => engineRef.current?.fire()}>
          <Crosshair size={26} />
        </button>
      </div>
    </section>
  );
}

function AuthTerminal({
  onAuth,
  onGuestSolo,
  levels,
  selectedLevelId,
  onLevelSelect,
}: {
  onAuth: (session: AuthSession) => void;
  onGuestSolo: () => void;
  levels: SoloLevel[];
  selectedLevelId: string;
  onLevelSelect: (levelId: string) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await apiRequest<{ token: string; user?: SessionUser; username: string }>(
        mode === "signin" ? "/auth/login" : "/auth/signup",
        {
          method: "POST",
          body: JSON.stringify({ username, password }),
        },
      );
      const user = normalizeSessionUser(payload);
      const session = { token: payload.token, user };
      storeSession(session);
      onAuth(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-terminal" onSubmit={submit}>
      <div className="corner top-left" />
      <div className="corner top-right" />
      <div className="corner bottom-left" />
      <div className="corner bottom-right" />

      <header className="auth-header">
        <span className="uae-flag" aria-hidden="true">
          <i />
          <b />
          <em />
          <strong />
        </span>
        <span>
          <small>UAE TACTICAL COMMAND</small>
          <strong>SECURE ACCESS TERMINAL</strong>
        </span>
      </header>

      <p className={`terminal-status ${error ? "is-error" : ""}`}>{error || "AWAITING AUTHENTICATION"}</p>

      <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
        <button type="button" data-active={mode === "signin"} onClick={() => setMode("signin")}>
          [ SIGN IN ]
        </button>
        <button type="button" data-active={mode === "signup"} onClick={() => setMode("signup")}>
          [ SIGN UP ]
        </button>
      </div>

      <label>
        <span>USERNAME / CALLSIGN</span>
        <input
          autoComplete="username"
          maxLength={20}
          minLength={3}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="your username"
          required
          value={username}
        />
      </label>

      <label>
        <span>PASSWORD</span>
        <input
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          minLength={6}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="******"
          required
          type="password"
          value={password}
        />
      </label>

      <button className="enter-button" disabled={busy} type="submit">
        <Crosshair size={14} />
        {busy ? "AUTHENTICATING" : "ENTER THE FRONTLINE"}
      </button>

      <button className="solo-enter-button" type="button" onClick={onGuestSolo}>
        <Bot size={15} />
        SOLO PLAY WITH AI
      </button>

      <div className="auth-levels" aria-label="Solo level selection">
        {levels.map((level) => (
          <button
            key={level.id}
            type="button"
            data-active={selectedLevelId === level.id}
            onClick={() => onLevelSelect(level.id)}
          >
            <Map size={13} />
            {level.name}
          </button>
        ))}
      </div>

      <small className="auth-note">USERNAME 3-20 CHARS / LETTERS, NUMBERS, UNDERSCORES ONLY</small>
    </form>
  );
}

function CommandMenus({
  session,
  onLogout,
  onSolo,
  onChallengeAccepted,
  soloActive,
  combatMode,
  levels,
  selectedLevelId,
  onLevelSelect,
}: {
  session: AuthSession;
  onLogout: () => void;
  onSolo: () => void;
  onChallengeAccepted: (opponentName: string, challengeId: number) => void;
  soloActive: boolean;
  combatMode: CombatMode;
  levels: SoloLevel[];
  selectedLevelId: string;
  onLevelSelect: (levelId: string) => void;
}) {
  const [panel, setPanel] = useState<UiPanel>("levels");
  const [friends, setFriends] = useState<FriendsPayload>({ friends: [], incoming: [], outgoing: [], challenges: [] });
  const [leaderboard, setLeaderboard] = useState<LeaderboardPlayer[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [friendName, setFriendName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshFriends = useCallback(async () => {
    try {
      const payload = await apiRequest<Partial<FriendsPayload>>("/friends", {}, session.token);
      setFriends(normalizeFriendsPayload(payload, session.user.id));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Friends service unavailable");
    }
  }, [session.token, session.user.id]);

  useEffect(() => {
    refreshFriends();
  }, [refreshFriends]);

  useEffect(() => {
    if (soloActive) setPanel(null);
  }, [soloActive]);

  const refreshLeaderboard = useCallback(async () => {
    setMessage("");
    try {
      const payload = await apiRequest<unknown>("/leaderboard", {}, session.token);
      setLeaderboard(normalizeLeaderboardPayload(payload));
    } catch (err) {
      setLeaderboard([]);
      setMessage(err instanceof Error ? err.message : "Leaderboard service unavailable");
    }
  }, [session.token]);

  useEffect(() => {
    if (panel === "leaderboard") void refreshLeaderboard();
  }, [panel, refreshLeaderboard]);

  useEffect(() => {
    if (panel !== "friends" || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const payload = await apiRequest<{ users: SearchResult[] }>(
          `/friends/search?q=${encodeURIComponent(query.trim())}`,
          {},
          session.token,
        );
        setResults(arrayField<SearchResult>(payload.users));
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Search failed");
      }
    }, 280);
    return () => window.clearTimeout(handle);
  }, [panel, query, session.token]);

  async function sendFriendRequest(username: string) {
    if (!username.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/friends/request", {
        method: "POST",
        body: JSON.stringify({ username: username.trim() }),
      }, session.token);
      setFriendName("");
      setQuery("");
      setMessage("Friend request sent");
      await refreshFriends();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Friend request failed");
    } finally {
      setBusy(false);
    }
  }

  async function respondFriend(id: number, action: "accept" | "reject") {
    try {
      await apiRequest(`/friends/${id}/respond`, {
        method: "POST",
        body: JSON.stringify({ action }),
      }, session.token);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("404")) throw err;
      await apiRequest(`/friends/${id}`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      }, session.token);
    }
    await refreshFriends();
  }

  async function challengeFriend(friend: SessionUser) {
    setBusy(true);
    setMessage("");
    try {
      const payload = await apiRequest<{ challenge: { id: number } }>("/friends/challenge", {
        method: "POST",
        body: JSON.stringify({ friendId: friend.id, mission: "uae-war-city" }),
      }, session.token);
      setPanel(null);
      setMessage("");
      onChallengeAccepted(friend.username, payload.challenge.id);
      await refreshFriends();
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        setPanel(null);
        onChallengeAccepted(friend.username, Date.now());
        return;
      }
      setMessage(err instanceof Error ? err.message : "Challenge failed");
    } finally {
      setBusy(false);
    }
  }

  async function respondChallenge(challenge: ChallengeSummary, action: "accept" | "decline") {
    setBusy(true);
    setMessage("");
    setFriends((current) => ({
      ...current,
      challenges: current.challenges.filter((item) => item.id !== challenge.id),
    }));
    try {
      await apiRequest(`/friends/challenge/${challenge.id}/respond`, {
        method: "POST",
        body: JSON.stringify({ action }),
      }, session.token);
      if (action === "accept") {
        setPanel(null);
        onChallengeAccepted(challenge.friend?.username ?? "Friend", challenge.id);
      } else {
        setMessage("Challenge declined");
      }
      await refreshFriends();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Challenge response failed");
      await refreshFriends();
    } finally {
      setBusy(false);
    }
  }

  if (soloActive) {
    const label = combatMode === "duel" ? "1V1 DUEL" : "SOLO AI";
    return (
      <section className="command-layer command-layer-active">
        <nav className="combat-exit-bar" aria-label="Active combat">
          <span>
            <Swords size={15} />
            {label}
          </span>
          <button type="button" onClick={onSolo}>
            <X size={15} />
            {combatMode === "duel" ? "Exit 1v1" : "Exit Solo"}
          </button>
        </nav>
      </section>
    );
  }

  return (
    <section className="command-layer">
      <nav className="command-bar" aria-label="Frontline menus">
        <span className="callsign">
          <Shield size={15} />
          {session.user.username}
        </span>
        <button type="button" data-active={panel === "levels"} onClick={() => setPanel(panel === "levels" ? null : "levels")}>
          <Map size={16} />
          Levels
        </button>
        <button type="button" data-active={panel === "leaderboard"} onClick={() => setPanel(panel === "leaderboard" ? null : "leaderboard")}>
          <Trophy size={16} />
          Leaderboard
        </button>
        <button type="button" data-active={panel === "friends"} onClick={() => setPanel(panel === "friends" ? null : "friends")}>
          <UserPlus size={16} />
          Add Friends
        </button>
        <button type="button" data-active={panel === "challenge"} onClick={() => setPanel(panel === "challenge" ? null : "challenge")}>
          <Swords size={16} />
          Challenge Friends
        </button>
        <button type="button" data-active={soloActive} onClick={onSolo}>
          <Bot size={16} />
          Solo Play with AI
        </button>
        <button type="button" className="icon-only" aria-label="Log out" onClick={onLogout}>
          <LogOut size={16} />
        </button>
      </nav>

      {panel === "levels" && (
        <aside className="side-panel level-panel">
          <header>
            <Map size={16} />
            <strong>Solo Operations</strong>
          </header>
          <div className="dashboard-metrics">
            <span>
              <b>{levels.length}</b>
              levels
            </span>
            <span>
              <b>{friends.friends.length}</b>
              friends
            </span>
            <span>
              <b>{soloActive ? "LIVE" : "READY"}</b>
              status
            </span>
          </div>
          <div className="level-grid">
            {levels.map((level) => (
              <button
                key={level.id}
                type="button"
                data-active={selectedLevelId === level.id}
                onClick={() => onLevelSelect(level.id)}
              >
                <span>
                  <strong>{level.name}</strong>
                  <small>{level.location}</small>
                </span>
                <em>{level.enemyCount} hostiles</em>
              </button>
            ))}
          </div>
          <button className="panel-primary" type="button" onClick={onSolo}>
            <Bot size={15} />
            {soloActive ? "Exit Solo" : "Launch Selected Level"}
          </button>
        </aside>
      )}

      {panel === "leaderboard" && (
        <aside className="side-panel leaderboard-panel">
          <header>
            <Trophy size={16} />
            <strong>Leaderboard</strong>
          </header>
          <div className="panel-list">
            {leaderboard.map((player, index) => (
              <div className="leaderboard-row" key={player.username}>
                <b>{index + 1}</b>
                <span>{player.username}</span>
                <small>{player.kills} K / {player.deaths} D / {player.matches} M</small>
              </div>
            ))}
            {leaderboard.length === 0 && (
              <div className="list-row muted">
                <span>Leaderboard reads from the real PostgreSQL API.</span>
                <small>No records loaded</small>
              </div>
            )}
          </div>
          <button className="panel-primary" type="button" onClick={() => void refreshLeaderboard()}>
            <RadioTower size={15} />
            Refresh
          </button>
          {message && <p className="panel-message">{message}</p>}
        </aside>
      )}

      {panel === "friends" && (
        <aside className="side-panel">
          <header>
            <Users size={16} />
            <strong>Add Friends</strong>
          </header>
          <form
            className="friend-form"
            onSubmit={(event) => {
              event.preventDefault();
              sendFriendRequest(friendName);
            }}
          >
            <input value={friendName} onChange={(event) => setFriendName(event.target.value)} placeholder="callsign" />
            <button disabled={busy} type="submit" aria-label="Send friend request">
              <Send size={15} />
            </button>
          </form>
          <label className="search-box">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="search users" />
          </label>
          <div className="panel-list">
            {results.map((result) => (
              <button
                key={result.id}
                disabled={!!result.friendshipStatus || busy}
                type="button"
                onClick={() => sendFriendRequest(result.username)}
              >
                <span>{result.username}</span>
                <small>{result.friendshipStatus ?? "send request"}</small>
              </button>
            ))}
            {friends.incoming.map((request) => (
              <div className="list-row" key={request.id}>
                <span>{request.from?.username}</span>
                <span className="row-actions">
                  <button type="button" aria-label="Accept request" onClick={() => respondFriend(request.id, "accept")}>
                    <Check size={14} />
                  </button>
                  <button type="button" aria-label="Reject request" onClick={() => respondFriend(request.id, "reject")}>
                    <X size={14} />
                  </button>
                </span>
              </div>
            ))}
            {friends.outgoing.map((request) => (
              <div className="list-row muted" key={request.id}>
                <span>{request.to?.username}</span>
                <small>pending</small>
              </div>
            ))}
          </div>
          {message && <p className="panel-message">{message}</p>}
        </aside>
      )}

      {panel === "challenge" && (
        <aside className="side-panel challenge-panel">
          <header>
            <RadioTower size={16} />
            <strong>Challenge Friends</strong>
          </header>
          <div className="panel-list">
            {friends.friends.map((friendship) => (
              <button
                key={friendship.id}
                disabled={busy}
                type="button"
                onClick={() => friendship.friend && challengeFriend(friendship.friend)}
              >
                <span>{friendship.friend?.username ?? "Friend"}</span>
                <small>UAE War City</small>
              </button>
            ))}
            {friends.challenges.map((challenge) => (
              <div className="list-row muted" key={challenge.id}>
                <span>{challenge.friend?.username ?? "Friend"}</span>
                {challenge.direction === "incoming" && challenge.status === "pending" ? (
                  <span className="row-actions">
                    <button disabled={busy} type="button" aria-label="Accept challenge" onClick={() => respondChallenge(challenge, "accept")}>
                      <Check size={14} />
                    </button>
                    <button disabled={busy} type="button" aria-label="Decline challenge" onClick={() => respondChallenge(challenge, "decline")}>
                      <X size={14} />
                    </button>
                  </span>
                ) : (
                  <small>{challenge.direction} / {challenge.status}</small>
                )}
              </div>
            ))}
          </div>
          {message && <p className="panel-message">{message}</p>}
        </aside>
      )}
    </section>
  );
}

function LoadingOverlay({ hud }: { hud: HudSnapshot }) {
  if (!hud.loading) return null;

  const progress = Math.round(clamp(hud.loadingProgress, 0, 100));
  return (
    <section className="loading-layer" aria-live="polite" aria-label="Asset loading">
      <div className="loading-terminal">
        <div className="corner top-left" />
        <div className="corner top-right" />
        <div className="corner bottom-left" />
        <div className="corner bottom-right" />
        <div className="loading-header">
          <span className="uae-flag" aria-hidden="true">
            <i />
            <b />
            <em />
            <strong />
          </span>
          <span>
            <small>UAE TACTICAL COMMAND</small>
            <strong>LOADING FRONTLINE ASSETS</strong>
          </span>
        </div>
        <div className="loading-readout">
          <span>{hud.message}</span>
          <strong>{progress}%</strong>
        </div>
        <div className="loading-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
    </section>
  );
}

function CombatHud({ hud, soloActive }: { hud: HudSnapshot; soloActive: boolean }) {
  const health = `${hud.health}%`;
  const armor = `${hud.armor}%`;
  const stamina = `${hud.stamina}%`;
  const missionStatus = hud.gameOver ? "FAILED" : hud.missionComplete ? "CLEAR" : hud.paused ? "PAUSED" : "LIVE";
  return (
    <section className="combat-hud" data-active={soloActive} data-game-over={hud.gameOver}>
      {soloActive && !hud.gameOver && !hud.missionComplete && !hud.paused && <div className="center-crosshair" aria-hidden="true" />}
      <div className="hud-strip">
        <span data-status={missionStatus.toLowerCase()}>
          <RadioTower size={14} />
          {missionStatus}
        </span>
        <span>
          <Shield size={14} />
          HEALTH
          <b style={{ width: health }} />
          <strong>{hud.health}</strong>
        </span>
        <span>
          <Shield size={14} />
          ARMOR
          <b style={{ width: armor }} />
          <strong>{hud.armor}</strong>
        </span>
        <span>
          <RadioTower size={14} />
          STAMINA
          <b style={{ width: stamina }} />
          <strong>{hud.stamina}</strong>
        </span>
        <span>
          <Crosshair size={14} />
          {hud.ammo}/{hud.reserve}
        </span>
        <span>
          <Bot size={14} />
          {hud.enemies}
        </span>
        <span>
          <Swords size={14} />
          {hud.kills}
        </span>
        <span>
          <Map size={14} />
          {hud.levelName}
        </span>
        <span>
          <RadioTower size={14} />
          {hud.fps} FPS
        </span>
      </div>
      <p>{hud.message}</p>
    </section>
  );
}

function MissionOverlay({
  hud,
  soloActive,
  onResume,
  onRetry,
  onNextLevel,
  onMainMenu,
}: {
  hud: HudSnapshot;
  soloActive: boolean;
  onResume: () => void;
  onRetry: () => void;
  onNextLevel: () => void;
  onMainMenu: () => void;
}) {
  if (!soloActive || (!hud.gameOver && !hud.missionComplete && !hud.paused)) return null;

  const state = hud.gameOver ? "failed" : hud.missionComplete ? "complete" : "paused";
  const kicker = state === "failed" ? "MISSION FAILED" : state === "complete" ? "MISSION CLEAR" : "MISSION PAUSED";
  const title = state === "failed" ? "KILLED IN ACTION" : state === "complete" ? "AREA SECURED" : "TACTICAL HOLD";
  const detail =
    state === "complete"
      ? `${hud.levelName} / ${hud.kills} hostiles cleared`
      : `${hud.levelName} / ${hud.kills} confirmed`;

  return (
    <section className="death-overlay" data-state={state}>
      <div className="death-panel">
        <small>{kicker}</small>
        <strong>{title}</strong>
        <span>{detail}</span>
        <div className="death-actions">
          {state === "paused" ? (
            <button type="button" onClick={onResume}>
              <Crosshair size={16} />
              Resume
            </button>
          ) : state === "complete" ? (
            <button type="button" onClick={onNextLevel}>
              <Map size={16} />
              Next Level
            </button>
          ) : (
            <button type="button" onClick={onRetry}>
              <RotateCcw size={16} />
              Retry
            </button>
          )}
          {state !== "failed" && (
            <button type="button" onClick={onRetry}>
              <RotateCcw size={16} />
              Restart
            </button>
          )}
          <button type="button" onClick={onMainMenu}>
            <Home size={16} />
            Main Menu
          </button>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const engineControlRef = useRef<FrontlineEngine | null>(null);
  const [session, setSession] = useState<AuthSession | null>(() => restoreSession());
  const [hud, setHud] = useState<HudSnapshot>(EMPTY_HUD);
  const [combatMode, setCombatMode] = useState<CombatMode>("idle");
  const [duelOpponent, setDuelOpponent] = useState("");
  const [duelMissionId, setDuelMissionId] = useState("");
  const [selectedLevelId, setSelectedLevelId] = useState(SOLO_LEVELS[0].id);
  const soloActive = combatMode !== "idle";

  useEffect(() => {
    const current = restoreSession();
    if (!current) return;
    apiRequest<{ user: SessionUser; token?: string }>("/auth/me", {}, current.token)
      .then((payload) => {
        const next = { token: current.token, user: normalizeSessionUser(payload) };
        storeSession(next);
        setSession(next);
      })
      .catch(() => {
        storeSession(null);
        setSession(null);
      });
  }, []);

  const handleHud = useCallback((snapshot: HudSnapshot) => setHud(snapshot), []);
  const handleEngineReady = useCallback((engine: FrontlineEngine | null) => {
    engineControlRef.current = engine;
  }, []);
  const shellClass = useMemo(() => `frontline-shell ${soloActive ? "is-solo" : ""}`, [soloActive]);

  function selectLevel(levelId: string) {
    setSelectedLevelId(levelId);
    engineControlRef.current?.setLevel(levelId);
  }

  function startOrStopSolo() {
    if (soloActive) {
      setCombatMode("idle");
      setDuelOpponent("");
      setDuelMissionId("");
      return;
    }
    engineControlRef.current?.setSoloActive(true);
    setDuelOpponent("");
    setDuelMissionId("");
    setCombatMode("solo");
  }

  function startDuel(opponentName: string, challengeId: number) {
    if (!session) return;
    const label = opponentName || "Friend";
    const missionId = `friend-duel-${challengeId}`;
    setDuelOpponent(label);
    setDuelMissionId(missionId);
    engineControlRef.current?.startDuel(label, missionId, session.token, session.user.username);
    setCombatMode("duel");
  }

  function retrySolo() {
    if (combatMode === "duel") {
      if (!session) return;
      const label = duelOpponent || "Friend";
      const missionId = duelMissionId || `friend-duel-${Date.now()}`;
      setDuelMissionId(missionId);
      engineControlRef.current?.startDuel(label, missionId, session.token, session.user.username);
      setCombatMode("duel");
      return;
    }
    engineControlRef.current?.setSoloActive(true);
    setDuelMissionId("");
    setCombatMode("solo");
  }

  function resumeSolo() {
    engineControlRef.current?.setPaused(false);
  }

  function nextLevel() {
    const currentIndex = SOLO_LEVELS.findIndex((level) => level.id === selectedLevelId);
    const next = SOLO_LEVELS[(currentIndex + 1) % SOLO_LEVELS.length];
    setSelectedLevelId(next.id);
    engineControlRef.current?.setLevel(next.id);
    engineControlRef.current?.setSoloActive(true);
    setDuelOpponent("");
    setDuelMissionId("");
    setCombatMode("solo");
  }

  function logout() {
    if (session) {
      apiRequest("/auth/logout", { method: "POST" }, session.token).catch(() => {});
    }
    storeSession(null);
    setSession(null);
    setCombatMode("idle");
    setDuelOpponent("");
    setDuelMissionId("");
  }

  return (
    <main className={shellClass}>
      <GameCanvas
        combatMode={combatMode}
        duelOpponent={duelOpponent}
        duelMissionId={duelMissionId}
        sessionToken={session?.token ?? ""}
        playerName={session?.user.username ?? ""}
        levelId={selectedLevelId}
        onHud={handleHud}
        onEngineReady={handleEngineReady}
      />
      <LoadingOverlay hud={hud} />
      <CombatHud hud={hud} soloActive={soloActive} />
      <TouchControls soloActive={soloActive && !hud.loading && !hud.gameOver && !hud.missionComplete && !hud.paused} engineRef={engineControlRef} />
      <MissionOverlay
        hud={hud}
        soloActive={soloActive}
        onResume={resumeSolo}
        onRetry={retrySolo}
        onNextLevel={nextLevel}
        onMainMenu={() => {
          setCombatMode("idle");
          setDuelOpponent("");
          setDuelMissionId("");
        }}
      />
      {!session && soloActive && !hud.gameOver && !hud.missionComplete && (
        <section className="guest-solo-bar">
          <button
            type="button"
            onClick={() => {
              setCombatMode("idle");
              setDuelOpponent("");
              setDuelMissionId("");
            }}
          >
            <X size={15} />
            {combatMode === "duel" ? "EXIT 1V1" : "EXIT SOLO"}
          </button>
        </section>
      )}
      {!session && !soloActive ? (
        <section className="auth-layer">
          <AuthTerminal
            onAuth={setSession}
            onGuestSolo={() => {
              setDuelOpponent("");
              setDuelMissionId("");
              setCombatMode("solo");
            }}
            levels={SOLO_LEVELS}
            selectedLevelId={selectedLevelId}
            onLevelSelect={selectLevel}
          />
        </section>
      ) : session ? (
        <CommandMenus
          session={session}
          onLogout={logout}
          onSolo={startOrStopSolo}
          onChallengeAccepted={startDuel}
          soloActive={soloActive}
          combatMode={combatMode}
          levels={SOLO_LEVELS}
          selectedLevelId={selectedLevelId}
          onLevelSelect={selectLevel}
        />
      ) : null}
    </main>
  );
}
