const API_BASE_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_API_BASE_URL) ||
  "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  body: string;
  path: string;

  constructor(path: string, status: number, body: string, statusText: string) {
    super(`API ${path} failed (${status}): ${body || statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(
      path,
      res.status,
      text || "",
      res.statusText,
    );
  }

  return res.json() as Promise<T>;
}

export interface RoutingCase {
  ktas: number;
  complaint_id: number;
  complaint_label: string;
  required_procedure_groups: string[];
  required_procedure_group_labels: string[];
}

export type CoverageLevel = "FULL" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface RoutingCandidateHospital {
  id: string;
  name: string;
  address?: string;
  phone?: string | null;
  emergency_phone?: string | null;
  latitude: number;
  longitude: number;
  procedure_beds: Record<string, { api_beds?: number; effective_beds?: number }>;
  total_effective_beds: number;
  has_any_bed: boolean;
  groups_with_beds: string[];
  groups_with_beds_labels: string[];
  supported_complaints: number[];
  supported_complaint_labels: string[];
  mkiosk_flags: string[];
  coverage_score: number;
  coverage_level: CoverageLevel;
  priority_score: number;
  reason_summary: string;
  distance?: number;
  duration_sec?: number;
}

export interface STTVitals {
  avpu?: string;
  rr?: number;
  bp_sys?: number;
  bp_dia?: number;
  hr?: number;
  bt?: number;
  spo2?: number;
  [key: string]: any;
}

export interface RoutingCandidateResponse {
  followup_id?: string | null;
  case: RoutingCase;
  hospitals: RoutingCandidateHospital[];
  stt_vitals?: STTVitals | null;
}

export interface KtasRoutePayload {
  ktas_level: number;
  chief_complaint: string;
  hospital_followup?: string | null;
  current_sigungu_code?: string | null;
  current_sigungu_name?: string | null;
  user_lat?: number | null;
  user_lon?: number | null;
  min_valid_hospitals?: number;
}

export interface NearestRoutingRequest extends RoutingCandidateResponse {
  user_lat: number;
  user_lon: number;
}

export interface RoutePathRequest {
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
}

export interface RoutePathPoint {
  lat: number;
  lon: number;
}

export interface RoutePathResponse {
  path: RoutePathPoint[];
  distance: number;
  duration_sec: number;
}

export async function routeFromKTAS(
  payload: KtasRoutePayload,
): Promise<RoutingCandidateResponse> {
  return postJson<RoutingCandidateResponse>("/api/ktas/route/seoul", payload);
}

export async function routeNearest(
  payload: NearestRoutingRequest,
): Promise<RoutingCandidateResponse> {
  return postJson<RoutingCandidateResponse>(
    "/api/ktas/route/seoul/nearest",
    payload,
  );
}

export async function routePath(
  payload: RoutePathRequest,
): Promise<RoutePathResponse> {
  return postJson<RoutePathResponse>("/api/ktas/route/path", payload);
}

export async function predictAudio(formData: FormData): Promise<RoutingCandidateResponse> {
  const res = await fetch(`${API_BASE_URL}/api/ktas/predict-audio`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Audio predict failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json() as Promise<RoutingCandidateResponse>;
}

export async function predictText(text: string): Promise<RoutingCandidateResponse> {
  return postJson<RoutingCandidateResponse>("/api/ktas/predict-text", { text });
}
