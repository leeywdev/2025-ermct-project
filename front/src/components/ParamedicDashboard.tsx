import React, { useState, useEffect, useCallback } from 'react';
import { 
  ArrowLeft,
  Mic,
  Phone,
  CheckCircle2,
  Activity,
  Heart,
  Thermometer,
  Wind,
  Brain,
  Building,
  Loader2,
  Send,
  Stethoscope,
  ChevronRight,
  Navigation,
  RotateCcw,
  Siren,
  Clock,
  Trophy,
  Medal,
  X,
  ChevronDown,
  MapPinned,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ModernButton, 
  ModernCard, 
  ModernInput, 
  ModernSelect,
  TEXT_TITLE, 
  cn 
} from './ui/DesignSystem';
import { Hospital, PatientData } from '../types';
import { supabase } from '../utils/supabase/client';
import {
  ApiError,
  routeFromKTAS,
  routeNearest,
  routePath,
  KtasRoutePayload,
  RoutingCandidateResponse,
  RoutingCandidateHospital,
  predictAudio,
  predictText,
} from '../utils/api';
import { useRef } from 'react';

const TMAP_API_KEY = import.meta.env.VITE_TMAP_API_KEY || '';
const KAKAO_MAP_APP_KEY =
  import.meta.env.VITE_KAKAO_MAP_KEY || import.meta.env.VITE_KAKAO_MAP_APP_KEY || '';
const TMAP_API_KEY_ERROR_MESSAGE = 'Tmap API 키가 설정되지 않았습니다.';
const KAKAO_MAP_API_KEY_ERROR_MESSAGE = 'Kakao 지도 API 키가 설정되지 않았습니다.';

type RouteSummary = {
  distanceKm: number;
  durationMin: number;
};

type RouteResult = {
  path: Array<{ lat: number; lon: number }>;
  summary: RouteSummary;
};

type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';
type MapCoordinate = { lat: number; lon: number };
type MarkerEntry = {
  lat: number;
  lon: number;
  title: string;
  selected?: boolean;
  current?: boolean;
  rank?: number;
};
type NormalizedKtasCase = {
  ktas: number | null;
  complaint_id: number | null;
  complaint_label?: string | null;
  corrected_text?: string | null;
};

const DEFAULT_MAP_CENTER = { lat: 37.4200, lon: 127.1268 };
const MIN_AUDIO_BLOB_BYTES = 10000;
const MIN_AUDIO_BYTES_PER_SECOND = 1500;
const MIN_RECORDING_MS = 800;
const COMPLAINT_ID_TO_CHIEF_COMPLAINT: Record<number, string> = {
  1: "chest_pain",
  2: "dyspnea",
  3: "neuro",
  4: "abdominal",
  5: "bleeding",
  6: "altered",
  7: "trauma",
  8: "obgyn",
  9: "pediatric",
  10: "psychiatric",
};
const CURRENT_LOCATION_MARKER_SVG = encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
    <circle cx="17" cy="17" r="13" fill="#2563EB" fill-opacity="0.18" />
    <circle cx="17" cy="17" r="9" fill="#2563EB" stroke="#FFFFFF" stroke-width="3" />
    <circle cx="17" cy="17" r="3" fill="#FFFFFF" />
  </svg>
`);

function getRankColor(rank?: number) {
  if (rank === 0) return '#EAB308';
  if (rank === 1) return '#94A3B8';
  if (rank === 2) return '#F97316';
  return '#00796B';
}

function buildHospitalMarkerSvg(color: string, rank?: number, selected = false) {
  const outerStroke = selected ? '#0F172A' : '#FFFFFF';
  const shadowOpacity = selected ? '0.28' : '0.18';
  const ringStroke = selected ? 3 : 2;
  const rankLabel = rank != null && rank >= 0 ? String(rank + 1) : '';

  return encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48">
      <path d="M18 45C18 45 6 29.5 6 19C6 11.82 11.82 6 19 6C26.18 6 32 11.82 32 19C32 29.5 18 45 18 45Z"
        fill="${color}" fill-opacity="${shadowOpacity}" />
      <path d="M18 42C18 42 8 28.8 8 19.2C8 13.01 13.15 8 19.5 8C25.85 8 31 13.01 31 19.2C31 28.8 18 42 18 42Z"
        fill="${color}" stroke="${outerStroke}" stroke-width="${ringStroke}" />
      <circle cx="19.5" cy="19" r="6.5" fill="#FFFFFF" />
      <text x="19.5" y="22.8" text-anchor="middle" font-family="Arial, sans-serif" font-size="9.5" font-weight="700" fill="${color}">${rankLabel}</text>
    </svg>
  `);
}

declare global {
  interface Window {
    kakao?: any;
  }
}

function toFiniteCoordinate(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeCoordinate(
  label: string,
  latValue: unknown,
  lonValue: unknown,
): MapCoordinate | null {
  const lat = toFiniteCoordinate(latValue);
  const lon = toFiniteCoordinate(lonValue);

  if (lat == null || lon == null) {
    console.warn(`[Map] Invalid coordinate for ${label}`, { lat: latValue, lon: lonValue });
    return null;
  }

  if (lat < 33 || lat > 39 || lon < 124 || lon > 132) {
    console.warn(`[Map] Coordinate out of Korea bounds for ${label}`, { lat, lon });
  }

  return { lat, lon };
}

function formatMinutes(value?: number) {
  if (value == null || Number.isNaN(value)) return '-';
  if (value < 60) return `${value}분`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
}


function maskDisplayName(name?: string | null) {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 1) return '*';
  if (trimmed.length === 2) return trimmed[0] + '*';
  return trimmed[0] + '*'.repeat(trimmed.length - 2) + trimmed[trimmed.length - 1];
}

function parseOptionalInt(value?: string | null) {
  if (!value?.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumber(value?: string | null) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildRoutePolylines(kakaoMaps: any, path: any[], color: string) {
  const halo = new kakaoMaps.Polyline({
    path,
    strokeWeight: 10,
    strokeColor: '#FFFFFF',
    strokeOpacity: 0.95,
    strokeStyle: 'solid',
  });

  const main = new kakaoMaps.Polyline({
    path,
    strokeWeight: 6,
    strokeColor: color,
    strokeOpacity: 0.98,
    strokeStyle: 'solid',
  });

  return [halo, main];
}

function normalizePolylineCollection(value: any) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

interface ParamedicDashboardProps {
  userName: string;
  onLogout: () => void;
}

type ViewState = 'input' | 'review' | 'list' | 'confirm' | 'transferring' | 'completed';

export const ParamedicDashboard: React.FC<ParamedicDashboardProps> = ({ userName, onLogout }) => {
  const [view, setView] = useState<ViewState>('input');
  
  // Separate states for Listening vs Processing
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [ktasLocked, setKtasLocked] = useState(false); // 백엔드에서 받은 KTAS가 있으면 자동 계산을 잠금
  
  const [patientData, setPatientData] = useState<PatientData>({
    consciousness: 'Alert',
    respiration: '',
    bloodPressure: '',
    pulse: '',
    oxygenSaturation: '',
    temperature: '',
    symptoms: '',
    existingHospital: '',
    ktasLevel: null
  });

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [isLoadingHospitals, setIsLoadingHospitals] = useState(false);
  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [requestStatus, setRequestStatus] = useState<'waiting' | 'approved' | 'rejected'>('waiting');
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [routingResponse, setRoutingResponse] = useState<RoutingCandidateResponse | null>(null);
  const [pendingKtasCase, setPendingKtasCase] = useState<NormalizedKtasCase | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const [awaitingLocation, setAwaitingLocation] = useState(false);
  const [openHospitalId, setOpenHospitalId] = useState<string | null>(null);
  const [routeHospitalId, setRouteHospitalId] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('idle');
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recordTimeoutRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const locationFallbackTimeoutRef = useRef<number | null>(null);
  const nearestRequestInFlightRef = useRef(false);
  const lastNearestRequestKeyRef = useRef<string | null>(null);
  const routeRequestInFlightKeyRef = useRef<string | null>(null);
  const mapPanelRef = useRef<HTMLDivElement | null>(null);
  const kakaoMapRef = useRef<any>(null);
  const routePolylineRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);
  const routeCacheRef = useRef<Map<string, RouteResult>>(new Map());
  const activeRouteRequestKeyRef = useRef<string | null>(null);
  const [patientInfo, setPatientInfo] = useState({
    name: '',
    birthdate: '',
    age: '',
    gender: '',
  });

  const getToneByLevel = useCallback((level?: number | null) => {
    if (level === 1) return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700" };
    if (level === 2) return { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" };
    if (level === 3) return { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700" };
    return { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-700" };
  }, []);

  const mapSymptomToChiefComplaintCode = useCallback((symptomRaw: string | null | undefined) => {
    const symptom = (symptomRaw || "").toLowerCase();
    if (!symptom.trim()) return null;
    if (symptom.includes("chest_pain")) return "chest_pain";
    if (symptom.includes("가슴") || symptom.includes("흉통") || symptom.includes("chest")) return "chest_pain";
    if (symptom.includes("호흡") || symptom.includes("숨") || symptom.includes("dyspnea") || symptom.includes("resp") || symptom.includes("shortness of breath")) return "dyspnea";
    if (
      symptom.includes("flank pain") ||
      symptom.includes("renal colic") ||
      symptom.includes("kidney stone") ||
      symptom.includes("옆구리")
    ) return "abdominal";
    if (
      symptom.includes("신경") ||
      symptom.includes("편마비") ||
      symptom.includes("마비") ||
      symptom.includes("뇌졸중") ||
      symptom.includes("경련") ||
      symptom.includes("stroke") ||
      symptom.includes("acute focal weakness") ||
      symptom.includes("focal weakness") ||
      symptom.includes("unilateral weakness") ||
      symptom.includes("weakness on one side") ||
      symptom.includes("neuro deficit") ||
      symptom.includes("neurologic deficit") ||
      symptom.includes("paralysis") ||
      symptom.includes("hemiparesis")
    ) return "neuro";
    if (
      symptom.includes("low back pain") ||
      symptom.includes("lower back pain") ||
      symptom.includes("back pain") ||
      symptom.includes("lumbar pain") ||
      symptom.includes("lumbago") ||
      symptom.includes("back injury") ||
      symptom.includes("허리") ||
      symptom.includes("요통") ||
      symptom.includes("등 통증")
    ) return "trauma";
    if (symptom.includes("복통") || symptom.includes("소화") || symptom.includes("abdominal") || symptom.includes("gi ") || symptom.includes("배")) return "abdominal";
    if (symptom.includes("출혈") || symptom.includes("bleed") || symptom.includes("hematemesis") || symptom.includes("melena")) return "bleeding";
    if (symptom.includes("의식") || symptom.includes("altered") || symptom.includes("syncope") || symptom.includes("mental change")) return "altered";
    if (symptom.includes("외상") || symptom.includes("trauma") || symptom.includes("사고") || symptom.includes("골절") || symptom.includes("화상")) return "trauma";
    if (symptom.includes("산부인") || symptom.includes("ob") || symptom.includes("preg")) return "obgyn";
    if (symptom.includes("소아") || symptom.includes("pediatric") || symptom.includes("아이")) return "pediatric";
    if (symptom.includes("정신") || symptom.includes("psy")) return "psychiatric";
    return null;
  }, []);

  const normalizePredictResult = useCallback((result: any): NormalizedKtasCase => {
    const caseData = result?.case ?? result?.routingResponse?.case ?? result ?? {};
    const ktasValue = caseData?.ktas ?? caseData?.ktas_level ?? caseData?.ktasLevel;
    const complaintIdValue = caseData?.complaint_id ?? caseData?.complaintId;
    const ktas = ktasValue != null && Number.isFinite(Number(ktasValue)) ? Number(ktasValue) : null;
    const complaintId =
      complaintIdValue != null && Number.isFinite(Number(complaintIdValue))
        ? Number(complaintIdValue)
        : null;

    return {
      ktas,
      complaint_id: complaintId,
      complaint_label: caseData?.complaint_label ?? caseData?.complaintLabel ?? null,
      corrected_text: result?.corrected_text ?? result?.text ?? null,
    };
  }, []);

  const buildKtasRoutePayload = useCallback((
    coordinates?: { lat: number; lon: number } | null,
    caseOverride?: NormalizedKtasCase | null,
  ): KtasRoutePayload | null => {
    const effectiveCase = caseOverride ?? pendingKtasCase;
    const ktasLevel = Number(effectiveCase?.ktas ?? patientData.ktasLevel ?? routingResponse?.case?.ktas);
    const caseComplaintText = effectiveCase?.complaint_label || effectiveCase?.corrected_text;
    const mappedChiefComplaint =
      mapSymptomToChiefComplaintCode(patientData.symptoms) ||
      mapSymptomToChiefComplaintCode(caseComplaintText);
    const caseComplaintId = effectiveCase?.complaint_id ?? routingResponse?.case?.complaint_id;
    const chiefComplaintFromCase =
      typeof caseComplaintId === "number"
        ? COMPLAINT_ID_TO_CHIEF_COMPLAINT[caseComplaintId]
        : null;
    const chiefComplaint = mappedChiefComplaint || chiefComplaintFromCase;

    const payload: KtasRoutePayload = {
      ktas_level: ktasLevel,
      chief_complaint: chiefComplaint || patientData.symptoms,
      hospital_followup: patientData.existingHospital || undefined,
      user_lat: coordinates?.lat,
      user_lon: coordinates?.lon,
      min_valid_hospitals: 3,
    };

    if (!Number.isFinite(payload.ktas_level) || payload.ktas_level < 1) {
      console.error("[route/seoul] invalid ktas_level", payload);
      return null;
    }

    if (!chiefComplaint) {
      console.error("[route/seoul] invalid chief_complaint", {
        payload,
        symptoms: patientData.symptoms,
        caseOverride,
        routingCase: routingResponse?.case,
      });
      return null;
    }

    if (payload.user_lat == null || payload.user_lon == null) {
      console.warn("[route/seoul] missing location; requesting base recommendations without nearest sorting", payload);
    }

    return payload;
  }, [
    mapSymptomToChiefComplaintCode,
    patientData.existingHospital,
    patientData.ktasLevel,
    patientData.symptoms,
    pendingKtasCase,
    routingResponse?.case,
  ]);

  const requestRouteFromKTAS = useCallback(async (
    payload: KtasRoutePayload,
  ): Promise<RoutingCandidateResponse | null> => {
    const requestKey = JSON.stringify(payload);
    if (routeRequestInFlightKeyRef.current === requestKey) {
      console.warn("[route/seoul] duplicate request skipped", payload);
      return null;
    }

    routeRequestInFlightKeyRef.current = requestKey;
    try {
      return await routeFromKTAS(payload);
    } finally {
      routeRequestInFlightKeyRef.current = null;
    }
  }, []);

  // KTAS Logic
  useEffect(() => {
    if (ktasLocked) return; // 백엔드 KTAS가 이미 있으면 자동 계산하지 않음

    let level: number | null = null;
    const symptom = patientData.symptoms?.toLowerCase() || '';
    
    if (symptom.includes('가슴') || symptom.includes('통증') || symptom.includes('호흡') || symptom.includes('chest')) {
      level = 1;
    } 
    else if (parseInt(patientData.respiration || '0') > 30 || (parseInt(patientData.respiration || '0') < 10 && patientData.respiration !== '')) {
        level = 1;
    }
    else if (patientData.consciousness !== 'Alert') {
        level = 2;
    }
    else if (symptom.length > 5) {
      level = 3;
    }

    setPatientData(prev => ({ ...prev, ktasLevel: level }));
  }, [ktasLocked, patientData.symptoms, patientData.respiration, patientData.consciousness]);

  // Map backend hospital to UI model
  const mapToHospital = useCallback((h: RoutingCandidateHospital): Hospital => ({
    id: h.id,
    name: h.name,
    latitude: h.latitude,
    longitude: h.longitude,
    availableBeds: h.total_effective_beds ?? 0,
    eta: h.duration_sec ? Math.max(1, Math.round(h.duration_sec / 60)) : undefined,
    distance: typeof h.distance === 'number' ? Number((h.distance / 1000).toFixed(1)) : undefined,
    specialties: h.groups_with_beds_labels?.length ? h.groups_with_beds_labels : ['ER'],
    acceptanceRate: h.coverage_score ? Math.round(h.coverage_score * 100) : undefined,
    phoneNumber: h.phone || h.emergency_phone || '',
    reasonSummary: h.reason_summary,
    coverageLevel: h.coverage_level,
    coverageScore: h.coverage_score,
    mkioskFlags: h.mkiosk_flags,
    address: h.address,
  }), []);

  const runRecommendRouteFromCase = useCallback(async (
    caseOverride?: NormalizedKtasCase | null,
    coordinates?: { lat: number; lon: number } | null,
  ): Promise<RoutingCandidateResponse | null> => {
    const payload = buildKtasRoutePayload(coordinates ?? userLocation, caseOverride ?? pendingKtasCase);
    console.log("[recommend] route payload", payload);

    if (!payload) {
      return null;
    }

    const routeResult = await requestRouteFromKTAS(payload);
    console.log("[recommend] route response", routeResult);

    if (routeResult) {
      setRoutingResponse(routeResult);
      setHospitals(routeResult.hospitals.slice(0, 3).map(mapToHospital));
    }

    return routeResult;
  }, [
    buildKtasRoutePayload,
    mapToHospital,
    pendingKtasCase,
    requestRouteFromKTAS,
    userLocation,
  ]);

  const requestRecommendLocation = useCallback((): Promise<MapCoordinate | null> => {
    if (userLocation) return Promise.resolve(userLocation);

    if (!('geolocation' in navigator)) {
      console.warn("[recommend] geolocation unavailable; route request skipped");
      alert("현재 위치를 확인할 수 없어 병원 추천을 실행할 수 없습니다.");
      return Promise.resolve(null);
    }

    setAwaitingLocation(true);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coordinates = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          };
          setUserLocation(coordinates);
          setAwaitingLocation(false);
          resolve(coordinates);
        },
        (err) => {
          console.warn("[recommend] geolocation error; route request skipped", err);
          setAwaitingLocation(false);
          alert("현재 위치 권한이 필요합니다. 위치를 허용한 뒤 다시 시도해주세요.");
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
  }, [userLocation]);

  const handleRecommendHospitals = useCallback(async () => {
    console.log("[recommend] button clicked");
    const normalizedCase = pendingKtasCase ?? (
      routingResponse ? normalizePredictResult(routingResponse) : null
    );

    if (!normalizedCase?.ktas && !patientData.ktasLevel) {
      alert("KTAS 결과를 먼저 확인해주세요.");
      return;
    }

    setView('list');
    setHospitals([]);
    setIsLoadingHospitals(true);
    setLocationRequested(true);

    try {
      const coordinates = await requestRecommendLocation();
      if (!coordinates) {
        setHospitals([]);
        return;
      }

      const base = await runRecommendRouteFromCase(normalizedCase, coordinates);
      if (!base) return;

      await refineRoutingWithNearest(
        base,
        coordinates.lat,
        coordinates.lon,
      );
    } catch (err) {
      console.error('[recommend] route failed', err);
      setHospitals([]);
      setRoutingResponse(null);
    } finally {
      setIsLoadingHospitals(false);
      setAwaitingLocation(false);
    }
  }, [
    normalizePredictResult,
    patientData.ktasLevel,
    pendingKtasCase,
    requestRecommendLocation,
    routingResponse,
    runRecommendRouteFromCase,
  ]);

  const selectedRouteHospital = hospitals.find((hospital) => hospital.id === routeHospitalId) ?? null;

  const handleRouteHospitalChange = useCallback((hospital: Hospital) => {
    setRouteHospitalId((prev) => (prev === hospital.id ? prev : hospital.id));
  }, []);

  const refineRoutingWithNearest = useCallback(async (
    baseResponse: RoutingCandidateResponse,
    lat: number,
    lon: number,
  ) => {
    if (nearestRequestInFlightRef.current) return null;

    const alreadyHasDistance = baseResponse.hospitals.some(
      (h) => typeof h.distance === 'number',
    );
    if (alreadyHasDistance) return baseResponse;

    const requestKey = JSON.stringify({
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      hospitalIds: baseResponse.hospitals.map((h) => h.id),
    });
    if (lastNearestRequestKeyRef.current === requestKey) {
      return null;
    }

    nearestRequestInFlightRef.current = true;
    lastNearestRequestKeyRef.current = requestKey;
    try {
      const nearest = await routeNearest({
        ...baseResponse,
        user_lat: lat,
        user_lon: lon,
      });
      if (!nearest.hospitals?.length) {
        return null;
      }
      setRoutingResponse(nearest);
      setHospitals(nearest.hospitals.slice(0, 3).map(mapToHospital));
      return nearest;
    } catch (err) {
      console.error('Error fetching nearest recommendations:', err);
      return null;
    } finally {
      nearestRequestInFlightRef.current = false;
    }
  }, [mapToHospital]);

  // Sync hospitals when routingResponse is already available (e.g., from voice)
  useEffect(() => {
    if (routingResponse?.hospitals?.length) {
      setHospitals(routingResponse.hospitals.slice(0, 3).map(mapToHospital));
    }
  }, [routingResponse, mapToHospital]);

  // List view never starts routing by itself; recommendations are user initiated.
  useEffect(() => {
    if (view === 'list' && !locationRequested && !routingResponse?.hospitals?.length) {
      console.log('[route/list] route/seoul skipped; waiting for recommend button');
    }
  }, [locationRequested, routingResponse?.hospitals?.length, view]);

// Real-time Subscription for Transfer Request
  useEffect(() => {
    if (!currentRequestId) return;

    const channel = supabase
      .channel('request-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'transfer_requests',
          filter: `id=eq.${currentRequestId}`
        },
        (payload) => {
          console.log('Update received:', payload);
          if (payload.new.status === 'approved') {
            setRequestStatus('approved');
          } else if (payload.new.status === 'rejected') {
            setRequestStatus('rejected');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentRequestId]);

  const stopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recordTimeoutRef.current) {
      clearTimeout(recordTimeoutRef.current);
      recordTimeoutRef.current = null;
    }
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    } else {
      setIsListening(false);
    }
  };

  const applyBackendResult = useCallback((result: RoutingCandidateResponse) => {
    const normalizedCase = normalizePredictResult(result);
    console.log("[flow] normalized case", normalizedCase);
    setPendingKtasCase(normalizedCase);
    setRoutingResponse(null);
    setHospitals([]);
    const vitals = result.stt_vitals || {};
    const avpu = (vitals as any).avpu || (vitals as any).AVPU;
    const rr = (vitals as any).rr ?? (vitals as any).RR;
    const bpSys = (vitals as any).bp_sys ?? (vitals as any).BP_sys ?? (vitals as any).BP_SYS;
    const bpDia = (vitals as any).bp_dia ?? (vitals as any).BP_dia ?? (vitals as any).BP_DIA;
    const hr = (vitals as any).hr ?? (vitals as any).HR;
    const spo2 = (vitals as any).spo2 ?? (vitals as any).SpO2 ?? (vitals as any).SPO2;
    const bt = (vitals as any).bt ?? (vitals as any).BT;
    setPatientData((prev) => {
      const next = {
        ...prev,
        ktasLevel: result.case?.ktas ?? prev.ktasLevel,
        symptoms: result.case?.complaint_label ?? prev.symptoms,
        consciousness: avpu || prev.consciousness,
        respiration: rr != null ? String(rr) : prev.respiration,
        bloodPressure:
          bpSys != null && bpDia != null
            ? `${bpSys}/${bpDia}`
            : prev.bloodPressure,
        pulse: hr != null ? String(hr) : prev.pulse,
        oxygenSaturation: spo2 != null ? String(spo2) : prev.oxygenSaturation,
        temperature: bt != null ? String(bt) : prev.temperature,
      };
      console.log("[flow] final patientData", next);
      return next;
    });
    if (result.case?.ktas != null) {
      setKtasLocked(true);
    }
    console.log("[flow] saved case; waiting for recommend button");
  }, [normalizePredictResult]);

  const handleVoiceInput = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("이 브라우저에서는 음성 녹음이 지원되지 않습니다.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        console.log("[audio] dataavailable size:", e.data?.size);
        console.log("[audio] dataavailable type:", e.data?.type);

        if (e.data && e.data.size > 0) {
          mediaChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        setIsListening(false);
        const recordingDuration =
          recordingStartedAtRef.current != null
            ? Date.now() - recordingStartedAtRef.current
            : 0;
        recordingStartedAtRef.current = null;
        const chunkSizes = mediaChunksRef.current.map((chunk) => chunk.size);
        const blob = new Blob(mediaChunksRef.current, { type: mimeType });
        const durationSeconds = Math.max(recordingDuration / 1000, 1);
        const bytesPerSecond = blob.size / durationSeconds;

        stream.getTracks().forEach((t) => t.stop());

        setIsProcessingVoice(true);
        try {
          console.log("[audio] chunk count:", mediaChunksRef.current.length);
          console.log("[audio] chunk sizes:", chunkSizes);
          console.log("[audio] blob size:", blob.size);
          console.log("[audio] final blob size:", blob.size);
          console.log("[audio] final blob type:", blob.type);
          console.log("[audio] blob type:", blob.type);
          console.log("[audio] recording duration:", recordingDuration);
          console.log("[audio] bytes per second:", bytesPerSecond);

          if (import.meta.env.DEV) {
            const previewUrl = URL.createObjectURL(blob);
            console.log("[audio] preview url:", previewUrl);
          }

          if (
            blob.size < MIN_AUDIO_BLOB_BYTES ||
            recordingDuration < MIN_RECORDING_MS ||
            bytesPerSecond < MIN_AUDIO_BYTES_PER_SECOND
          ) {
            console.warn("[audio] suspiciously small recording; skip STT", {
              size: blob.size,
              durationMs: recordingDuration,
              bytesPerSecond,
              chunkCount: mediaChunksRef.current.length,
              chunkSizes,
            });
            throw new Error("음성이 제대로 녹음되지 않았습니다. 마이크 입력을 확인하고 다시 녹음해주세요.");
          }

          const file = new File([blob], "recording.webm", { type: blob.type || "audio/webm" });
          console.log("[audio] form data file:", file.name, file.type, file.size);

          const formData = new FormData();
          formData.append("audio", file);

          const result = await predictAudio(formData);
          console.log("[flow:voice] predict-audio response", result);
          console.log("[flow:voice] case", result?.case);
          console.log("[flow:voice] ktas", result?.case?.ktas);
          console.log("[flow:voice] complaint_id", result?.case?.complaint_id);
          console.log("[flow:voice] complaint_label", result?.case?.complaint_label);
          applyBackendResult(result);
          console.log("[flow:voice] normalized case", normalizePredictResult(result));
          console.log("[flow:voice] saved case; waiting for recommend button");
          setView("review");
        } catch (err) {
          console.error("음성 전송 실패:", err);
          alert(err instanceof Error ? err.message : "음성 인식에 실패했습니다. 다시 시도해 주세요.");
        } finally {
          setIsProcessingVoice(false);
        }
        recordTimeoutRef.current = null;
      };

      recordingStartedAtRef.current = Date.now();
      recorder.start(1000);
      setIsListening(true);

      recordTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, 60000);
    } catch (err) {
      console.error("마이크 접근 실패:", err);
      alert("마이크 권한을 허용해 주세요.");
    }
  };

  const handleHospitalSelect = async (hospital: Hospital) => {
    setSelectedHospital(hospital);
    setView('confirm');
    setRequestStatus('waiting');

    const { data: { user } } = await supabase.auth.getUser();
    const paramedicId = user?.id;
    const ktasLevel = patientData.ktasLevel;
    const recommendationCase = routingResponse?.case ?? null;
    const recommendationComplaintId = recommendationCase?.complaint_id;
    const complaintId =
      typeof recommendationComplaintId === 'number' && Number.isFinite(recommendationComplaintId)
        ? recommendationComplaintId
        : null;
    const complaintLabel = recommendationCase?.complaint_label || patientData.symptoms || null;
    const vitalsPulse = parseOptionalInt(patientData.pulse);
    const vitalsResp = parseOptionalInt(patientData.respiration);
    const vitalsSpo2 = parseOptionalInt(patientData.oxygenSaturation);
    const vitalsTemp = parseOptionalNumber(patientData.temperature);
    const routeEtaMin = routeSummary?.durationMin ?? hospital.eta ?? null;
    const routeDistanceKm = routeSummary?.distanceKm ?? hospital.distance ?? null;
    const displayName = maskDisplayName(patientInfo.name);
    const age = parseOptionalInt(patientInfo.age);
    const gender = patientInfo.gender || null;
    const ktasLabel = ktasLevel != null ? 'KTAS ' + ktasLevel : null;
    const ktasName = ktasLabel;
    const summary = patientData.symptoms
      ? [
          patientInfo.age ? patientInfo.age + ' years' : null,
          gender,
          patientData.symptoms,
          patientData.consciousness,
        ].filter(Boolean).join(' / ')
      : null;
    const recommendationReason = hospital.reasonSummary || null;
    const recommendationSnapshot = {
      selected_hospital: {
        id: hospital.id,
        name: hospital.name,
        address: hospital.address ?? null,
        phone: hospital.phoneNumber ?? null,
        eta_min: routeEtaMin,
        distance_km: routeDistanceKm,
        available_beds: hospital.availableBeds,
        coverage_level: hospital.coverageLevel ?? null,
        coverage_score: hospital.coverageScore ?? null,
        reason_summary: hospital.reasonSummary ?? null,
      },
      candidates: hospitals.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        eta_min: candidate.eta ?? null,
        distance_km: candidate.distance ?? null,
        available_beds: candidate.availableBeds,
        coverage_level: candidate.coverageLevel ?? null,
        coverage_score: candidate.coverageScore ?? null,
        reason_summary: candidate.reasonSummary ?? null,
      })),
      routing_case: routingResponse?.case ?? null,
    };

    const { data: sessionDebug } = await supabase.auth.getSession();
    const { data: userDebug } = await supabase.auth.getUser();
    const supabaseLocalStorageKeys = Object.keys(localStorage).filter((key) =>
      key.toLowerCase().includes('supabase'),
    );
    console.log('[auth-debug] before transfer_requests insert', {
      userId: userDebug.user?.id ?? null,
      sessionExists: Boolean(sessionDebug.session),
      accessTokenExists: Boolean(sessionDebug.session?.access_token),
      supabaseLocalStorageKeys,
    });

    const { data, error } = await supabase
      .from('transfer_requests')
      .insert({
        hospital_id: hospital.id,
        paramedic_id: paramedicId,
        status: 'waiting',
        ktas_level: ktasLevel,
        ktas_label: ktasLabel,
        symptoms: patientData.symptoms || null,
        consciousness: patientData.consciousness || null,
        vitals_bp: patientData.bloodPressure || null,
        vitals_pulse: vitalsPulse,
        vitals_resp: vitalsResp,
        vitals_spo2: vitalsSpo2,
        vitals_temp: vitalsTemp,
        route_eta_min: routeEtaMin,
        route_distance_km: routeDistanceKm,
        paramedic_name: userName || null,
        paramedic_unit: '119',
        paramedic_contact: null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Supabase transfer_requests insert error:', error);
      setTimeout(() => {
        setRequestStatus('approved');
      }, 2500);
      return;
    }

    if (data?.id) {
      setCurrentRequestId(data.id);

      const { error: patientCaseError } = await supabase
        .from('patient_cases')
        .insert({
          transfer_request_id: data.id,
          paramedic_id: paramedicId,
          display_name: displayName,
          age,
          gender,
          symptoms: patientData.symptoms || null,
          extra_note: null,
          summary,
          ktas_level: ktasLevel,
          ktas_label: ktasLabel,
          ktas_name: ktasName,
          complaint_id: complaintId,
          complaint_label: complaintLabel,
          consciousness: patientData.consciousness || null,
          vitals_bp: patientData.bloodPressure || null,
          vitals_pulse: vitalsPulse,
          vitals_resp: vitalsResp,
          vitals_spo2: vitalsSpo2,
          vitals_temp: vitalsTemp,
          existing_hospital: patientData.existingHospital || null,
          assigned_hospital_id: hospital.id,
          assigned_hospital_name: hospital.name,
          assigned_hospital_address: hospital.address || null,
          assigned_hospital_phone: hospital.phoneNumber || null,
          origin_lat: userLocation?.lat ?? null,
          origin_lon: userLocation?.lon ?? null,
          route_eta_min: routeEtaMin,
          route_distance_km: routeDistanceKm,
          recommendation_reason: recommendationReason,
          recommendation_snapshot: recommendationSnapshot,
          status: 'waiting',
        });

      if (patientCaseError) {
        console.error('Supabase patient_cases insert error:', patientCaseError);
      }
    }
  };

  const handleStartTransfer = async () => {
    setView('transferring');
    
    if (currentRequestId) {
        await supabase
            .from('transfer_requests')
            .update({ status: 'transferring' })
            .eq('id', currentRequestId);
    }
    
    setTimeout(async () => {
        if (currentRequestId) {
            await supabase
                .from('transfer_requests')
                .update({ status: 'completed' })
                .eq('id', currentRequestId);
        }
        setView('completed');
    }, 5000); 
  };

  const handleBack = () => {
    if (view === 'confirm') setView('list');
    else if (view === 'list') setView('input');
    else if (view === 'input') onLogout();
  };

  const handleReset = () => {
    setView('input');
    setKtasLocked(false);
    setRoutingResponse(null);
    setPendingKtasCase(null);
    setHospitals([]);
    setUserLocation(null);
    setLocationRequested(false);
    setAwaitingLocation(false);
    lastNearestRequestKeyRef.current = null;
    routeRequestInFlightKeyRef.current = null;
    clearLocationFallbackTimeout();
    setPatientInfo({
      name: '',
      birthdate: '',
      age: '',
      gender: '',
    });
    setPatientData({
      consciousness: 'Alert',
      respiration: '',
      bloodPressure: '',
      pulse: '',
      oxygenSaturation: '',
      temperature: '',
      symptoms: '',
      existingHospital: '',
      ktasLevel: null
    });
    setSelectedHospital(null);
    setOpenHospitalId(null);
    setRouteHospitalId(null);
    setRouteStatus('idle');
    setRouteSummary(null);
    setRouteError(null);
    routeCacheRef.current.clear();
    setRequestStatus('waiting');
    setCurrentRequestId(null);
  };

  const clearLocationFallbackTimeout = () => {
    if (locationFallbackTimeoutRef.current) {
      clearTimeout(locationFallbackTimeoutRef.current);
      locationFallbackTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    if (!hospitals.length) {
      setRouteHospitalId(null);
      setRouteStatus('idle');
      setRouteSummary(null);
      setRouteError(null);
      return;
    }

    setRouteHospitalId((prev) => {
      if (prev && hospitals.some((hospital) => hospital.id === prev)) {
        return prev;
      }
      return hospitals[0].id;
    });
  }, [hospitals]);

  const ensureKakaoMap = useCallback(async () => {
    if (!KAKAO_MAP_APP_KEY || !mapPanelRef.current) return null;

    if (window.kakao?.maps) {
      await new Promise<void>((resolve) => {
        window.kakao.maps.load(() => resolve());
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        const existingScript = document.querySelector<HTMLScriptElement>('script[data-kakao-map-sdk="true"]');
        if (existingScript) {
          existingScript.addEventListener('load', () => resolve(), { once: true });
          existingScript.addEventListener('error', () => reject(new Error('Kakao Map SDK load failed')), { once: true });
          return;
        }

        const script = document.createElement('script');
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_APP_KEY}&autoload=false`;
        script.async = true;
        script.dataset.kakaoMapSdk = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Kakao Map SDK load failed'));
        document.head.appendChild(script);
      });

      await new Promise<void>((resolve) => {
        window.kakao.maps.load(() => resolve());
      });
    }

    if (!kakaoMapRef.current && mapPanelRef.current) {
      kakaoMapRef.current = new window.kakao.maps.Map(mapPanelRef.current, {
        center: new window.kakao.maps.LatLng(DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lon),
        level: 6,
      });
    }

    return kakaoMapRef.current;
  }, []);

  const syncKakaoMapLayout = useCallback(async (map: any) => {
    if (!map || !mapPanelRef.current) return;

    // The map lives inside an animated panel; wait for layout to settle before fitting bounds.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const rect = mapPanelRef.current.getBoundingClientRect();
      console.log('[Map] Panel layout before relayout', {
        attempt,
        width: rect.width,
        height: rect.height,
      });

      if (rect.width > 0 && rect.height > 0) {
        map.relayout();
        return;
      }
    }

    console.warn('[Map] Panel height stayed at 0; forcing relayout with fallback size');
    map.relayout();
  }, []);

  const fetchDrivingRoute = useCallback(async (
    start: { lat: number; lon: number },
    end: { lat: number; lon: number },
  ) => {
    if (!TMAP_API_KEY) {
      throw new Error(TMAP_API_KEY_ERROR_MESSAGE);
    }

    const data = await routePath({
      start_lat: start.lat,
      start_lon: start.lon,
      end_lat: end.lat,
      end_lon: end.lon,
    });

    if (!Array.isArray(data.path) || !data.path.length) {
      throw new Error('Tmap route data is incomplete');
    }

    const normalizedPath = data.path
      .map((point, index) => normalizeCoordinate(`routePath[${index}]`, point.lat, point.lon))
      .filter((point): point is MapCoordinate => point != null);

    if (normalizedPath.length < 2) {
      console.error('[Map] Route path is too short for polyline rendering', {
        rawRoutePathLength: data.path.length,
        normalizedRoutePathLength: normalizedPath.length,
        firstRawPoint: data.path[0],
        lastRawPoint: data.path[data.path.length - 1],
      });
      throw new Error('Tmap route path is invalid');
    }

    return {
      path: normalizedPath,
      summary: {
        distanceKm: Number((Number(data.distance) / 1000).toFixed(1)),
        durationMin: Math.max(1, Math.round(Number(data.duration_sec) / 60)),
      },
    } satisfies RouteResult;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const renderRouteMap = async () => {
      if (!KAKAO_MAP_APP_KEY) {
        setRouteStatus('idle');
        setRouteSummary(null);
        setRouteError(KAKAO_MAP_API_KEY_ERROR_MESSAGE);
        return;
      }

      const map = await ensureKakaoMap();
      if (!map || !window.kakao?.maps || cancelled) return;
      await syncKakaoMapLayout(map);

      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];

      normalizePolylineCollection(routePolylineRef.current).forEach((polyline) => polyline.setMap(null));
      routePolylineRef.current = [];

      const bounds = new window.kakao.maps.LatLngBounds();
      let hasBounds = false;
      const setFallbackView = () => {
        map.relayout();
        map.setCenter(new window.kakao.maps.LatLng(DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lon));
        map.setLevel(7);
      };
      const extendBounds = (coordinate: MapCoordinate | MarkerEntry | null) => {
        if (!coordinate) return null;
        const latLng = new window.kakao.maps.LatLng(coordinate.lat, coordinate.lon);
        bounds.extend(latLng);
        hasBounds = true;
        return latLng;
      };
      const markerEntries: MarkerEntry[] = [];

      const origin = userLocation
        ? normalizeCoordinate('origin', userLocation.lat, userLocation.lon)
        : null;

      if (origin) {
        markerEntries.push({
          lat: origin.lat,
          lon: origin.lon,
          title: '현재 위치',
          current: true,
        });
      }

      hospitals.forEach((hospital) => {
        const hospitalRank = hospitals.findIndex((item) => item.id === hospital.id);
        const coordinate = normalizeCoordinate(
          `hospital:${hospital.id}`,
          hospital.latitude,
          hospital.longitude,
        );

        if (!coordinate) {
          return;
        }

        markerEntries.push({
          lat: coordinate.lat,
          lon: coordinate.lon,
          title: hospital.name,
          selected: hospital.id === routeHospitalId,
          rank: hospitalRank,
        });
      });

      markersRef.current = markerEntries.map((entry) => {
        const position = extendBounds(entry);
        const image = entry.current
          ? new window.kakao.maps.MarkerImage(
              `data:image/svg+xml;charset=UTF-8,${CURRENT_LOCATION_MARKER_SVG}`,
              new window.kakao.maps.Size(34, 34),
              {
                offset: new window.kakao.maps.Point(17, 17),
              },
            )
          : new window.kakao.maps.MarkerImage(
              `data:image/svg+xml;charset=UTF-8,${buildHospitalMarkerSvg(
                getRankColor(entry.rank),
                entry.rank,
                !!entry.selected,
              )}`,
              new window.kakao.maps.Size(36, 48),
              {
                offset: new window.kakao.maps.Point(18, 46),
              },
            );
        const marker = new window.kakao.maps.Marker({
          position,
          title: entry.title,
          image,
        });

        if (entry.current) {
          marker.setZIndex(10);
        } else if (entry.selected) {
          marker.setZIndex(8);
        }

        marker.setMap(map);
        return marker;
      });

      const selectedHospital = hospitals.find((hospital) => hospital.id === routeHospitalId) ?? null;
      const selectedHospitalRank = selectedHospital
        ? hospitals.findIndex((hospital) => hospital.id === selectedHospital.id)
        : -1;
      const selectedRouteColor = getRankColor(selectedHospitalRank);
      const selectedHospitalCoordinate = selectedHospital
        ? normalizeCoordinate(
            `selectedHospital:${selectedHospital.id}`,
            selectedHospital.latitude,
            selectedHospital.longitude,
          )
        : null;
      if (!selectedHospital || !userLocation) {
        setRouteStatus('idle');
        setRouteSummary(null);
        setRouteError(null);
        if (hasBounds) {
          map.relayout();
          map.setBounds(bounds, 48, 48, 48, 48);
        } else {
          setFallbackView();
        }
        return;
      }

      if (!origin || !selectedHospitalCoordinate) {
        console.warn('[Map] Invalid route endpoints', {
          origin,
          selectedHospital,
          selectedHospitalCoordinate,
        });
        setRouteStatus('error');
        setRouteSummary(null);
        setRouteError('지도 좌표가 올바르지 않습니다.');
        if (hasBounds) {
          map.relayout();
          map.setBounds(bounds, 48, 48, 48, 48);
        } else {
          setFallbackView();
        }
        return;
      }

      const routeKey = `${origin.lat.toFixed(5)}:${origin.lon.toFixed(5)}:${selectedHospital.id}`;
      activeRouteRequestKeyRef.current = routeKey;

      if (!TMAP_API_KEY) {
        console.error(
          '[Tmap] Missing VITE_TMAP_API_KEY. Add it to front/.env and restart the Vite dev server.',
        );
        setRouteStatus('error');
        setRouteSummary(null);
        setRouteError(TMAP_API_KEY_ERROR_MESSAGE);
        if (hasBounds) {
          map.relayout();
          map.setBounds(bounds, 48, 48, 48, 48);
        } else {
          setFallbackView();
        }
        return;
      }

      const cachedRoute = routeCacheRef.current.get(routeKey);
      if (cachedRoute) {
        if (cancelled || activeRouteRequestKeyRef.current !== routeKey) return;

        const cachedLatLngPath = cachedRoute.path.map(
          (point) => new window.kakao.maps.LatLng(point.lat, point.lon),
        );
        console.log({
          origin,
          selectedHospital: selectedHospitalCoordinate,
          routePathLength: cachedRoute.path.length,
          firstRoutePoint: cachedRoute.path[0],
          lastRoutePoint: cachedRoute.path[cachedRoute.path.length - 1],
          allRoutePointsAreLatLng: cachedLatLngPath.every(
            (point) => point instanceof window.kakao.maps.LatLng,
          ),
        });

        routePolylineRef.current = buildRoutePolylines(
          window.kakao.maps,
          cachedLatLngPath,
          selectedRouteColor,
        );
        normalizePolylineCollection(routePolylineRef.current).forEach((polyline) => polyline.setMap(map));
        extendBounds(origin);
        extendBounds(selectedHospitalCoordinate);
        cachedRoute.path.forEach((point) => {
          extendBounds(point);
        });
        if (hasBounds) {
          map.relayout();
          map.setBounds(bounds, 48, 48, 48, 48);
        } else {
          setFallbackView();
        }
        setRouteStatus('ready');
        setRouteSummary(cachedRoute.summary);
        setRouteError(null);
        return;
      }

      setRouteStatus('loading');
      setRouteSummary(null);
      setRouteError(null);

      try {
        const route = await fetchDrivingRoute(
          { lat: origin.lat, lon: origin.lon },
          { lat: selectedHospitalCoordinate.lat, lon: selectedHospitalCoordinate.lon },
        );

        if (cancelled || activeRouteRequestKeyRef.current !== routeKey) return;

        routeCacheRef.current.set(routeKey, route);
        const routeLatLngPath = route.path.map(
          (point) => new window.kakao.maps.LatLng(point.lat, point.lon),
        );
        console.log({
          origin,
          selectedHospital: selectedHospitalCoordinate,
          routePathLength: route.path.length,
          firstRoutePoint: route.path[0],
          lastRoutePoint: route.path[route.path.length - 1],
          allRoutePointsAreLatLng: routeLatLngPath.every(
            (point) => point instanceof window.kakao.maps.LatLng,
          ),
        });
        routePolylineRef.current = buildRoutePolylines(
          window.kakao.maps,
          routeLatLngPath,
          selectedRouteColor,
        );
        normalizePolylineCollection(routePolylineRef.current).forEach((polyline) => polyline.setMap(map));
        extendBounds(origin);
        extendBounds(selectedHospitalCoordinate);
        route.path.forEach((point) => {
          extendBounds(point);
        });
        if (hasBounds) {
          map.relayout();
          map.setBounds(bounds, 48, 48, 48, 48);
        } else {
          setFallbackView();
        }
        setRouteStatus('ready');
        setRouteSummary(route.summary);
        setRouteError(null);
      } catch (error) {
        if (cancelled || activeRouteRequestKeyRef.current !== routeKey) return;
        if (error instanceof ApiError) {
          console.error('Tmap route API request failed', {
            path: error.path,
            statusCode: error.status,
            responseBody: error.body,
          });
        } else {
          console.error('Error fetching Tmap route:', error);
        }
        if (hasBounds) {
          map.relayout();
          map.setBounds(bounds, 48, 48, 48, 48);
        } else {
          setFallbackView();
        }
        setRouteStatus('error');
        setRouteSummary(null);
        setRouteError('경로 정보를 불러오지 못했습니다');
      }
    };

    renderRouteMap();

    return () => {
      cancelled = true;
    };
  }, [ensureKakaoMap, fetchDrivingRoute, hospitals, routeHospitalId, syncKakaoMapLayout, userLocation]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach((marker) => marker.setMap(null));
      normalizePolylineCollection(routePolylineRef.current).forEach((polyline) => polyline.setMap(null));
    };
  }, []);

  const displayValue = (value?: string | null) => {
    const text = String(value ?? '').trim();
    return text || "-";
  };

  const displayWithUnit = (value: string | undefined, unit: string) => {
    const text = displayValue(value);
    if (text === "-") return text;
    return text.endsWith(unit) ? text : `${text} ${unit}`;
  };

  const displaySpO2 = (value: string | undefined) => {
    const text = displayValue(value);
    if (text === "-") return text;
    return text.endsWith("%") ? text : `${text}%`;
  };

  const displayTemperature = (value: string | undefined) => {
    const text = displayValue(value);
    if (text === "-") return text;

    const numericValue = Number(text);
    if (Number.isFinite(numericValue)) {
      return `${numericValue.toFixed(1)}°C`;
    }
    return text;
  };

  const tone = getToneByLevel(patientData.ktasLevel);

  return (
    <div className="emt-app-shell relative flex min-h-screen flex-col overflow-hidden bg-[#F5F7FA] font-sans text-slate-800 shadow-2xl">
      
      {/* Header */}
      <header className="bg-white border-b border-gray-100 p-4 sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-600">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-sm font-bold text-gray-400 uppercase tracking-wide">Emergency Transfer</h1>
            <p className="text-lg font-bold text-gray-900 leading-none">{userName}</p>
          </div>
        </div>
        <div className="h-10 w-10 bg-red-50 rounded-full flex items-center justify-center">
            <Stethoscope size={20} className="text-[#C0392B]" />
        </div>
      </header>

      {/* Main Content */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          
          {/* VIEW: INPUT */}
          {view === 'input' && (
            <motion.div 
              key="input" 
              className="relative flex-1 overflow-y-auto px-5 py-6 pb-24 md:px-8 md:py-8 md:pb-10"
              initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }}
            >
              {/* 1. LISTENING POPUP */}
              <AnimatePresence>
                {isListening && (
                   <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center rounded-xl"
                   >
                     <motion.div 
                       animate={{ scale: [1, 1.2, 1] }}
                       transition={{ duration: 1.5, repeat: Infinity }}
                       className="bg-red-600 p-6 rounded-full mb-6 shadow-2xl shadow-red-900/50"
                     >
                        <Mic size={48} className="text-white" />
                     </motion.div>
                      <h3 className="text-3xl font-black text-white mb-2">녹음 중...</h3>
                      <p className="text-white/60 text-xl font-bold">멈추려면 아래 버튼을 눌러 주세요</p>
                     
                     <div className="mt-8 flex gap-1 h-8 items-center justify-center">
                        {[1,2,3,4,5].map(i => (
                            <motion.div 
                                key={i}
                                animate={{ height: [10, 32, 10] }}
                                transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                                className="w-2 bg-white rounded-full"
                            />
                        ))}
                     </div>
                      <div className="mt-6">
                        <ModernButton variant="primary" size="lg" onClick={stopVoiceRecording} className="px-6">
                          녹음 중지
                        </ModernButton>
                      </div>
                   </motion.div>
                )}
              </AnimatePresence>

              {/* 2. PROCESSING POPUP */}
              <AnimatePresence>
                {isProcessingVoice && (
                   <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center rounded-xl"
                   >
                     <div className="relative mb-8">
                        <div className="absolute inset-0 bg-teal-100 rounded-full blur-xl opacity-50 animate-pulse"></div>
                        <motion.div 
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                          className="relative bg-white p-4 rounded-full shadow-lg border-4 border-gray-100"
                        >
                           <Loader2 size={48} className="text-[#00796B]" />
                        </motion.div>
                     </div>
                     <h3 className="text-3xl font-black text-gray-900 mb-2">데이터 분석 중</h3>
                     <p className="text-[#00796B] text-lg font-bold animate-pulse">KTAS 등급 산정 및 바이탈 입력...</p>
                   </motion.div>
                )}
              </AnimatePresence>

              <div className="emt-page-container mt-6">
                <div className="emt-input-grid">
                  <div className="emt-area-patient">
              {/* NEW: KTAS Live Status Display */}
              {/* Patient Basic Info */}
              <div className="mb-4 md:mb-0">
                <ModernCard className="space-y-4 border-2 border-gray-200">
                  <div className="flex items-center gap-2 text-sm font-bold text-gray-500 uppercase tracking-widest">
                    <Activity size={16} /> 환자 기본 정보
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-3">
                      <p className="text-sm font-bold text-gray-500">환자 이름</p>
                      <ModernInput
                        value={patientInfo.name}
                        onChange={(e) => setPatientInfo((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="예) 홍길동 / 김철수"
                        className="text-lg font-semibold"
                      />
                    </div>
                    <div className="space-y-3">
                      <p className="text-sm font-bold text-gray-500">생년월일</p>
                      <ModernInput
                        value={patientInfo.birthdate}
                        onChange={(e) => setPatientInfo((prev) => ({ ...prev, birthdate: e.target.value }))}
                        placeholder="예) 1951-02-14"
                        className="text-lg font-semibold"
                      />
                    </div>
                    <div className="space-y-3">
                      <p className="text-sm font-bold text-gray-500">나이</p>
                      <ModernInput
                        value={patientInfo.age}
                        onChange={(e) => setPatientInfo((prev) => ({ ...prev, age: e.target.value }))}
                        placeholder="예) 73"
                        className="text-lg font-semibold"
                      />
                    </div>
                    <div className="space-y-3">
                      <p className="text-sm font-bold text-gray-500">성별</p>
                      <ModernSelect
                        value={patientInfo.gender}
                        onChange={(e) => setPatientInfo((prev) => ({ ...prev, gender: e.target.value }))}
                        className="!text-lg !font-semibold"
                      >
                        <option value="">선택</option>
                        <option value="M">남성</option>
                        <option value="F">여성</option>
                        <option value="X">기타/미정</option>
                      </ModernSelect>
                    </div>
                  </div>
                </ModernCard>
              </div>
                  </div>

              {/* Voice Input Button + Stop */}
              <div className="emt-area-voice flex flex-col gap-3">
                 <ModernButton 
                    variant="voice" 
                    size="full" 
                    onClick={handleVoiceInput}
                    disabled={isListening || isProcessingVoice}
                    className="flex items-center justify-center gap-3 py-6 shadow-lg shadow-indigo-200 md:min-h-[88px]"
                 >
                    <Mic size={28} />
                    <span className="font-black text-xl">음성으로 입력하기</span>
                 </ModernButton>
                 <ModernButton
                    variant="secondary"
                    size="full"
                    onClick={stopVoiceRecording}
                    disabled={!isListening}
                    className="flex items-center justify-center gap-2 rounded-[28px] border border-gray-200 bg-white py-5 shadow-sm md:min-h-[84px]"
                 >
                    <span className="font-bold">{isListening ? '녹음 중지' : '녹음 대기 중'}</span>
                 </ModernButton>
              </div>

                  <div className="emt-area-vitals">
                {/* Vitals Section */}
                <section>
                    <h3 className="text-lg font-black text-gray-800 uppercase tracking-tight mb-3 ml-1 flex items-center gap-2">
                        <Activity className="text-red-500" size={20} /> Vitals & Consciousness
                    </h3>
                    <ModernCard className="space-y-5 md:space-y-4">
                        <div className="grid grid-cols-2 gap-5 md:gap-4">
                            <div className="col-span-2">
                                <label className="flex items-center gap-2 text-lg font-bold text-gray-600 mb-2">
                                    <Brain size={20} className="text-[#00796B]" /> 의식상태 (AVPU)
                                </label>
                                <ModernSelect 
                                    value={patientData.consciousness}
                                    onChange={(e) => setPatientData(prev => ({...prev, consciousness: e.target.value}))}
                                    className="!text-2xl !font-black !py-4 !h-16 text-gray-900"
                                >
                                    <option value="Alert">Alert (명료)</option>
                                    <option value="Voice">Voice (언어반응)</option>
                                    <option value="Pain">Pain (통증반응)</option>
                                    <option value="Unresponsive">Unresponsive (무반응)</option>
                                </ModernSelect>
                            </div>
                            
                            <div className="col-span-2 md:col-span-1">
                                <label className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-600">
                                    <Activity size={20} className="text-[#00796B]" /> 혈압
                                </label>
                                <ModernInput 
                                    placeholder="120/80" 
                                    value={patientData.bloodPressure}
                                    onChange={(e) => setPatientData(prev => ({...prev, bloodPressure: e.target.value}))}
                                    className="text-center font-mono !text-2xl !font-black !h-16 tracking-wider"
                                />
                            </div>
                            <div className="col-span-2 md:col-span-1">
                                <label className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-600">
                                    <Heart size={20} className="text-[#00796B]" /> 맥박
                                </label>
                                <ModernInput 
                                    placeholder="80" 
                                    value={patientData.pulse}
                                    onChange={(e) => setPatientData(prev => ({...prev, pulse: e.target.value}))}
                                    type="number"
                                    className="text-center font-mono !text-2xl !font-black !h-16"
                                />
                            </div>
                            <div className="col-span-2 md:col-span-1">
                                <label className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-600">
                                    <Wind size={20} className="text-[#00796B]" /> 호흡
                                </label>
                                <ModernInput 
                                    placeholder="16" 
                                    value={patientData.respiration}
                                    onChange={(e) => setPatientData(prev => ({...prev, respiration: e.target.value}))}
                                    type="number"
                                    className="text-center font-mono !text-2xl !font-black !h-16"
                                />
                            </div>
                            <div className="col-span-2 md:col-span-1">
                                <label className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-600">
                                    <Activity size={20} className="text-[#00796B]" /> 산소포화도 (SpO₂)
                                </label>
                                <ModernInput
                                    placeholder="예) 95"
                                    value={patientData.oxygenSaturation}
                                    onChange={(e) => setPatientData(prev => ({...prev, oxygenSaturation: e.target.value}))}
                                    type="number"
                                    className="text-center font-mono !text-2xl !font-black !h-16"
                                />
                            </div>
                            <div className="col-span-2 md:col-span-1">
                                <label className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-600">
                                    <Thermometer size={20} className="text-[#00796B]" /> 체온
                                </label>
                                <ModernInput 
                                    placeholder="36.5" 
                                    value={patientData.temperature}
                                    onChange={(e) => setPatientData(prev => ({...prev, temperature: e.target.value}))}
                                    type="number"
                                    className="text-center font-mono !text-2xl !font-black !h-16"
                                />
                            </div>
                        </div>
                    </ModernCard>
                </section>
                  </div>

                  <div className="emt-area-medical">
                {/* Symptoms & History */}
                <section>
                    <h3 className="text-lg font-black text-gray-800 uppercase tracking-tight mb-3 ml-1 flex items-center gap-2">
                        <Stethoscope className="text-blue-500" size={20} /> Medical Info
                    </h3>
                    <ModernCard className="space-y-6">
                        <div>
                            <label className="text-lg font-bold text-gray-600 mb-2 block">Symptoms</label>
                            <textarea 
                                className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-5 text-2xl font-bold focus:bg-white focus:border-[#00796B] focus:ring-4 focus:ring-[#00796B]/20 outline-none transition-all resize-none leading-snug text-gray-900"
                                rows={3}
                                placeholder="Enter symptoms..."
                                value={patientData.symptoms}
                                onChange={(e) => setPatientData(prev => ({...prev, symptoms: e.target.value}))}
                            />
                        </div>
                        <div>
                             <label className="flex items-center gap-2 text-lg font-bold text-gray-600 mb-2">
                                <Building size={20} className="text-[#00796B]" /> Previous hospital (optional)
                            </label>
                            <ModernInput 
                                placeholder="Type hospital name" 
                                value={patientData.existingHospital}
                                onChange={(e) => setPatientData(prev => ({...prev, existingHospital: e.target.value}))}
                                className="!text-2xl !font-black !h-16"
                            />
                        </div>
                    </ModernCard>
                </section>
                  </div>
                </div>
              </div>

              {/* Bottom Action */}
              <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-gray-100 bg-white p-5 safe-area-bottom shadow-[0_-4px_20px_rgba(0,0,0,0.05)] md:sticky md:mt-8 md:border-t-0 md:bg-transparent md:p-0 md:shadow-none">
                 <div className="mx-auto flex w-full max-w-[760px] items-center gap-4 md:max-w-5xl">
                    <ModernButton
                      onClick={async () => {
                        // 텍스트 입력 기반으로 백엔드 KTAS/바이탈도 받아오기
                        if (patientData.symptoms.trim().length === 0) {
                          setView('review');
                          return;
                        }
                        try {
                          setIsProcessingVoice(true);
                          const genderText = patientInfo.gender === 'M' ? '남성' : patientInfo.gender === 'F' ? '여성' : '';
                          const oxygenSaturationText = patientData.oxygenSaturation.trim()
                            ? ` 산소포화도 ${patientData.oxygenSaturation.trim()}%.`
                            : '';
                          const report = `환자 보고: ${patientInfo.age || ''}세 ${genderText} 환자. 이름: ${patientInfo.name || '정보 없음'}. 생년월일: ${patientInfo.birthdate || '정보 없음'}. 주증상: ${patientData.symptoms}. 의식: ${patientData.consciousness}. 호흡수: ${patientData.respiration || '정보 없음'}.${oxygenSaturationText} 맥박: ${patientData.pulse || '정보 없음'}. 혈압: ${patientData.bloodPressure || '정보 없음'}. 체온: ${patientData.temperature || '정보 없음'}. 평소 병원: ${patientData.existingHospital || '정보 없음'}.`;
                          console.log("[flow:text] predict request payload", { text: report });
                          const result = await predictText(report);
                          console.log("[flow:text] predict response", result);
                          applyBackendResult(result);
                          console.log("[flow:text] normalized case", normalizePredictResult(result));
                          console.log("[flow:text] saved case; waiting for recommend button");
                        } catch (err) {
                          console.error("텍스트 기반 KTAS 호출 실패:", err);
                          alert("텍스트로 KTAS 계산에 실패했습니다. 다시 시도해 주세요.");
                        } finally {
                          setIsProcessingVoice(false);
                          setView('review');
                        }
                      }}
                      className="h-16 flex-1 text-2xl shadow-lg shadow-teal-200"
                      size="lg"
                    >
                        KTAS 확인 후 추천
                    </ModernButton>
                 </div>
              </div>
            </motion.div>
          )}

          {/* VIEW: REVIEW (KTAS & patient info) */}
          {view === 'review' && (
            <motion.div
              key="review"
              className="flex-1 overflow-y-auto p-4 pb-8 bg-[#F5F7FA]"
              initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }}
            >
              <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-teal-50 rounded-lg">
                  <Stethoscope size={24} className="text-[#00796B]" />
                </div>
                <h2 className={TEXT_TITLE}>KTAS 판정 및 환자 정보</h2>
              </div>

              <ModernCard
                className={cn(
                  "space-y-4 border-2",
                  tone.bg,
                  tone.border
                )}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      "h-16 w-16 rounded-2xl border-2 flex items-center justify-center text-3xl font-black",
                      patientData.ktasLevel === 1
                        ? "bg-red-600 border-red-700 text-white"
                        : patientData.ktasLevel === 2
                        ? "bg-orange-500 border-orange-600 text-white"
                        : patientData.ktasLevel === 3
                        ? "bg-yellow-500 border-yellow-600 text-white"
                        : "bg-gray-50 border-gray-200 text-gray-500"
                    )}
                  >
                    {patientData.ktasLevel ?? "-"}
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 font-bold">KTAS</p>
                    <p className="text-xl font-black text-gray-900">
                      {patientData.ktasLevel ? `Level ${patientData.ktasLevel}` : "미계산"}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-gray-500 font-bold mb-1">주증상</p>
                  <p className="text-lg font-semibold text-gray-900 whitespace-pre-wrap leading-relaxed">
                    {patientData.symptoms || "입력되지 않음"}
                  </p>
                </div>

                <div className={cn("rounded-2xl p-3", getToneByLevel(patientData.ktasLevel).bg, getToneByLevel(patientData.ktasLevel).border)}>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      <p className="text-sm text-gray-500 font-bold mb-1">의식(AVPU)</p>
                      <p className="text-2xl font-black text-gray-800">{patientData.consciousness || "-"}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      <p className="text-sm text-gray-500 font-bold mb-1">혈압</p>
                      <p className="text-2xl font-black text-gray-800">{displayWithUnit(patientData.bloodPressure, "mmHg")}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      <p className="text-sm text-gray-500 font-bold mb-1">맥박</p>
                      <p className="text-2xl font-black text-gray-800">{displayWithUnit(patientData.pulse, "bpm")}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      <p className="text-sm text-gray-500 font-bold mb-1">호흡수</p>
                      <p className="text-2xl font-black text-gray-800">{displayWithUnit(patientData.respiration, "/min")}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      <p className="text-sm text-gray-500 font-bold mb-1">산소포화도 (SpO₂)</p>
                      <p className="text-2xl font-black text-gray-800">{displaySpO2(patientData.oxygenSaturation)}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      <p className="text-sm text-gray-500 font-bold mb-1">체온</p>
                      <p className="text-2xl font-black text-gray-800">{displayTemperature(patientData.temperature)}</p>
                    </div>
                  </div>
                </div>
              </ModernCard>

              <div className="mt-8 flex gap-3">
                <ModernButton
                  variant="primary"
                  size="full"
                  onClick={handleRecommendHospitals}
                  className="flex-1"
                >
                  병원 추천 보기
                </ModernButton>
                <ModernButton
                  variant="secondary"
                  size="full"
                  onClick={() => setView('input')}
                  className="flex-1"
                >
                  정보 다시 입력
                </ModernButton>
              </div>
            </motion.div>
          )}

          {/* VIEW: LIST (Hospitals) */}
          {view === 'list' && (
            <motion.div 
              key="list" 
              className="flex-1 overflow-y-auto p-4 pb-8 bg-[#F5F7FA]"
              initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }}
            >
              <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-red-50 rounded-lg">
                    <Send size={24} className="text-[#C0392B]" />
                </div>
                <h2 className={TEXT_TITLE}>추천 병원 (Top 3)</h2>
              </div>

              {isLoadingHospitals ? (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                      <Loader2 className="animate-spin mb-2" size={32} />
                      <p>병원 정보를 불러오는 중...</p>
                  </div>
              ) : hospitals.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400 text-center">
                  <p className="font-bold text-lg mb-2">추천 가능한 병원이 없습니다.</p>
                  <p className="text-sm">KTAS 등급과 증상을 입력하면 추천을 받을 수 있습니다.</p>
                </div>
              ) : (
                <div className="space-y-4">
                    <ModernCard className="overflow-hidden border border-gray-200 bg-white/95 p-0 shadow-md">
                      <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <MapPinned size={18} className="text-[#00796B]" />
                              <h3 className="text-base font-black text-gray-900">이송 경로 안내</h3>
                            </div>
                            <p className="mt-1 text-sm font-semibold text-gray-700">
                              {selectedRouteHospital ? `현재 위치 → ${selectedRouteHospital.name}` : '선택된 병원이 없습니다'}
                            </p>
                          </div>
                          <div className="rounded-full bg-[#00796B]/10 px-3 py-1 text-[11px] font-bold text-[#00796B]">
                            {routeStatus === 'loading' ? '경로 계산 중' : routeStatus === 'ready' ? '경로 표시 중' : '지도 보기'}
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                            <p className="text-[11px] font-bold text-gray-500">예상 시간</p>
                            <p className="mt-1 text-lg font-black text-[#00796B]">
                              {routeSummary ? formatMinutes(routeSummary.durationMin) : selectedRouteHospital?.eta != null ? formatMinutes(selectedRouteHospital.eta) : '-'}
                            </p>
                          </div>
                          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                            <p className="text-[11px] font-bold text-gray-500">거리</p>
                            <p className="mt-1 text-lg font-black text-[#00796B]">
                              {routeSummary ? `${routeSummary.distanceKm}km` : selectedRouteHospital?.distance != null ? `${selectedRouteHospital.distance}km` : '-'}
                            </p>
                          </div>
                          <div className="col-span-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 sm:col-span-1">
                            <p className="text-[11px] font-bold text-gray-500">경로 상태</p>
                            <p className="mt-1 text-sm font-bold text-gray-800">
                              {!userLocation
                                ? '현재 위치 확인 후 경로를 계산합니다'
                                : routeError
                                  ? routeError
                                  : routeStatus === 'loading'
                                    ? 'Tmap 경로를 계산하고 있습니다'
                                    : routeStatus === 'ready'
                                      ? 'Kakao 지도에 경로를 표시했습니다'
                                      : '병원을 선택하면 경로를 보여줍니다'}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="relative">
                        <div
                          ref={mapPanelRef}
                          className="h-[280px] w-full bg-slate-100 sm:h-[300px]"
                          style={{ minHeight: 280 }}
                        />
                        {!KAKAO_MAP_APP_KEY && (
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-100/90 px-6 text-center text-sm font-semibold text-gray-600">
                            {KAKAO_MAP_API_KEY_ERROR_MESSAGE}
                          </div>
                        )}
                        {KAKAO_MAP_APP_KEY && !!routeError && (
                          <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-2xl border border-red-200 bg-white/95 px-4 py-3 text-center text-sm font-semibold text-red-700 shadow-sm">
                            {routeError}
                          </div>
                        )}
                        {KAKAO_MAP_APP_KEY && hospitals.length > 0 && (
                          <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold text-gray-700 shadow-sm">
                            현재 위치 + 추천 병원 {hospitals.length}곳
                          </div>
                        )}
                      </div>
                    </ModernCard>
                    {hospitals.map((hospital, idx) => (
                    <ModernCard 
                        key={hospital.id} 
                        onClick={() => handleRouteHospitalChange(hospital)}
                        className={cn(
                            "group active:scale-[0.98] transition-all relative overflow-hidden border-2 cursor-pointer shadow-md hover:shadow-xl",
                            routeHospitalId === hospital.id
                              ? "border-[#00796B] bg-[#E8F6F4] ring-2 ring-[#00796B]"
                              : idx === 0 ? "border-yellow-400 bg-yellow-50/50" :
                              idx === 1 ? "border-slate-300 bg-slate-50/50" :
                              "border-orange-200 bg-orange-50/50"
                        )}
                    >
                        <div className="flex justify-between items-start gap-3 mb-4">
                          <div className="flex-1 min-w-0">
                              <h3 className="text-2xl font-black text-gray-900 mb-2 leading-tight break-words">
                                {hospital.name}
                              </h3>
                              <div className="flex flex-col gap-1">
                                {hospital.address && (
                                  <span className="px-2 py-0.5 rounded-full bg-white border border-gray-200 text-[10px] text-gray-600 truncate max-w-[220px]">
                                    {hospital.address}
                                  </span>
                                )}
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-[10px] border self-start",
                                  hospital.phoneNumber
                                    ? "bg-white text-emerald-700 border-emerald-200"
                                    : "bg-gray-100 text-gray-500 border-gray-200"
                                )}>
                                  {hospital.phoneNumber ? `☎ ${hospital.phoneNumber}` : '전화 정보 없음'}
                                </span>
                              </div>
                          </div>

                          <div className="flex flex-col items-end gap-2 shrink-0">
                              <div className={cn(
                                  "px-4 py-2 rounded-2xl font-black text-sm flex items-center gap-1 shadow-sm",
                                  idx === 0 ? "bg-yellow-400 text-yellow-900" :
                                  idx === 1 ? "bg-slate-400 text-white" :
                                  "bg-orange-300 text-orange-900"
                              )}>
                                  {idx === 0 && <Trophy size={14} />}
                                  {idx === 1 && <Medal size={14} />}
                                  {idx === 2 && <Medal size={14} />}
                                  {idx === 0 ? "1순위" : `${idx + 1}순위`}
                              </div>
                              <div className="px-3 py-1 rounded-full bg-white border border-gray-200 text-[10px] font-bold text-gray-700 shadow-sm">
                                커버리지 {hospital.acceptanceRate ?? '--'}%
                              </div>
                              <button
                                className={cn(
                                  "rounded-full border px-3 py-1 text-[11px] font-bold transition-colors",
                                  routeHospitalId === hospital.id
                                    ? "border-[#00796B] bg-[#00796B] text-white"
                                    : "border-[#00796B]/20 bg-white text-[#00796B] hover:bg-[#00796B]/5"
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRouteHospitalChange(hospital);
                                }}
                              >
                                경로 보기
                              </button>
                              <button
                                className="flex items-center gap-1 text-xs font-bold text-[#00796B] hover:text-[#005f56]"
                                aria-expanded={openHospitalId === hospital.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenHospitalId((prev) => prev === hospital.id ? null : hospital.id);
                                }}
                              >
                                상세 보기
                                <ChevronDown
                                  size={14}
                                  className="transition-transform duration-200"
                                  style={{
                                    transform: openHospitalId === hospital.id ? 'rotate(180deg)' : 'rotate(0deg)',
                                  }}
                                />
                              </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 mb-5">
                            <div className="bg-white/80 p-2 rounded-xl text-center border border-gray-100 shadow-sm">
                                <p className="text-[10px] text-gray-500 font-bold uppercase mb-0.5">가용 병상</p>
                                <p className="text-xl font-black text-[#388E3C]">{hospital.availableBeds}</p>
                            </div>
                            <div className="bg-white/80 p-2 rounded-xl text-center border border-gray-100 shadow-sm">
                                <p className="text-[10px] text-gray-500 font-bold uppercase mb-0.5">예상 시간</p>
                                <p className="text-xl font-black text-[#00796B]">{hospital.eta != null ? `${hospital.eta}분` : '-'}</p>
                            </div>
                            <div className="bg-white/80 p-2 rounded-xl text-center border border-gray-100 shadow-sm">
                                <p className="text-[10px] text-gray-500 font-bold uppercase mb-0.5">거리</p>
                                <p className="text-xl font-black text-[#00796B]">{hospital.distance != null ? `${hospital.distance}km` : '-'}</p>
                            </div>
                        </div>

                        {openHospitalId === hospital.id && (
                          <div className="mt-3 mb-4 space-y-4 bg-white/90 rounded-2xl border border-gray-100 p-4 shadow-sm">
                            <div className="space-y-2">
                              <p className="text-[11px] text-gray-500 font-bold tracking-tight">추천 사유</p>
                              <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                                {hospital.reasonSummary || '정보 없음'}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <p className="text-[11px] text-gray-500 font-bold tracking-tight">지원 주증상</p>
                              <div className="flex flex-wrap gap-2">
                                {(hospital.specialties || []).map((sp, i) => (
                                  <span
                                    key={`${hospital.id}-support-${i}`}
                                    className="px-2 py-0.5 bg-gray-50 border border-gray-200 rounded-xl text-[10px] text-gray-700"
                                  >
                                    {sp}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-3 border-t border-gray-200 pt-4 mt-2">
                            {/* Call Button - Icon Only, Distinct Color */}
                            <button 
                                className={cn(
                                  "w-16 h-16 rounded-2xl text-white flex items-center justify-center shadow-lg active:scale-90 transition-all border-2 z-20",
                                  hospital.phoneNumber ? "bg-green-500 border-green-600 active:bg-green-600" : "bg-gray-300 border-gray-300 cursor-not-allowed"
                                )}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!hospital.phoneNumber) return;
                                    window.location.href = `tel:${hospital.phoneNumber}`;
                                }}
                                disabled={!hospital.phoneNumber}
                            >
                                <Phone size={32} fill="currentColor" />
                            </button>

                            <button
                                type="button"
                                className="flex-1 h-16 bg-blue-600 rounded-2xl flex items-center justify-between px-6 text-white shadow-lg border-2 border-blue-700 group-active:bg-blue-700 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleHospitalSelect(hospital);
                                }}
                            >
                                <span className="text-xl font-black">수송 요청 보내기</span>
                                <div className="bg-white/20 p-2 rounded-full">
                                    <ChevronRight size={24} className="group-hover:translate-x-1 transition-transform" />
                                </div>
                            </button>
                        </div>
                    </ModernCard>
                    ))}
                </div>
              )}
            </motion.div>
          )}
          {/* VIEW: CONFIRMATION & TRANSFER */}
          {(view === 'confirm' || view === 'transferring' || view === 'completed') && (
            <motion.div 
              key="confirm" 
              className="flex-1 flex flex-col p-6 bg-white"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            >
              {requestStatus === 'waiting' && view === 'confirm' ? (
                 <div className="flex-1 flex flex-col items-center justify-center text-center">
                    <div className="relative mb-8">
                       <div className="absolute inset-0 bg-yellow-100 rounded-full blur-xl opacity-60 animate-pulse"></div>
                       <div className="relative bg-white p-6 rounded-full shadow-lg border-2 border-yellow-100">
                          <Clock size={48} className="text-yellow-600 animate-spin-slow" />
                       </div>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">병원 수용 확인 중</h2>
                    <p className="text-gray-500">{selectedHospital?.name} 응급실에<br/>연결하고 있습니다.</p>
                 </div>
              ) : ((requestStatus === 'approved' || requestStatus === 'rejected') && view === 'confirm') ? (
                requestStatus === 'rejected' ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <div className="p-4 bg-red-50 rounded-full mb-6 ring-8 ring-red-50/50">
                            <X size={64} className="text-[#C0392B]" />
                        </div>
                        <h2 className="text-3xl font-bold text-[#C0392B] mb-2">이송 거절됨</h2>
                        <p className="text-gray-600 font-medium text-lg">다른 병원을 선택해주세요.</p>
                        <ModernButton variant="primary" size="full" onClick={() => setView('list')} className="mt-8">
                            목록으로 돌아가기
                        </ModernButton>
                    </div>
                ) : (
                 <div className="flex-1 flex flex-col h-full">
                    <div className="flex-1 flex flex-col items-center justify-center text-center mb-8">
                        <div className="p-4 bg-green-50 rounded-full mb-6 ring-8 ring-green-50/50">
                            <CheckCircle2 size={64} className="text-[#388E3C]" />
                        </div>
                        <h2 className="text-3xl font-bold text-[#388E3C] mb-2">이송 승인 완료</h2>
                        <p className="text-gray-600 font-medium text-lg">{selectedHospital?.name}</p>
                    </div>

                    <ModernCard className="mb-6 bg-gray-50 border-gray-100">
                        <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-200">
                             <span className="text-gray-500 font-medium">예상 도착</span>
                             <span className="text-xl font-bold text-[#00796B]">{selectedHospital?.eta}분 후</span>
                        </div>
                         <div className="flex justify-between items-center">
                             <span className="text-gray-500 font-medium">확보 병상</span>
                             <span className="text-xl font-bold text-[#388E3C]">{selectedHospital?.availableBeds}개</span>
                        </div>
                    </ModernCard>

                    <div className="mt-auto">
                        <ModernButton variant="success" size="full" onClick={handleStartTransfer} className="shadow-lg shadow-green-200 text-lg py-5 animate-pulse">
                            이송 시작
                        </ModernButton>
                    </div>
                 </div>
                )
              ) : view === 'transferring' ? (
                 <div className="flex-1 flex flex-col items-center justify-center text-center">
                    <div className="relative mb-8">
                       <div className="absolute inset-0 bg-blue-100 rounded-full blur-2xl opacity-60 animate-pulse"></div>
                       <div className="relative bg-white p-8 rounded-full shadow-lg border-4 border-blue-100">
                          <Siren size={64} className="text-blue-600 animate-pulse" />
                       </div>
                    </div>
                    <h2 className="text-3xl font-bold text-gray-900 mb-4">이송 중입니다</h2>
                    <p className="text-xl text-[#00796B] font-bold mb-8">
                        {selectedHospital?.name}
                    </p>
                    <div className="flex items-center gap-2 text-gray-500 bg-gray-100 px-4 py-2 rounded-full">
                        <Navigation size={18} className="animate-bounce" />
                        <span>GPS 경로 안내 중...</span>
                    </div>
                 </div>
              ) : view === 'completed' ? (
                 <div className="flex-1 flex flex-col items-center justify-center text-center h-full">
                    <div className="mb-8">
                        <div className="p-6 bg-gray-800 rounded-full mb-6 ring-8 ring-gray-100">
                            <CheckCircle2 size={64} className="text-white" />
                        </div>
                        <h2 className="text-3xl font-bold text-gray-900 mb-2">이송 완료</h2>
                        <p className="text-gray-500 text-lg">환자가 병원에 안전하게<br/>도착했습니다.</p>
                    </div>

                    <div className="w-full mt-auto">
                        <ModernButton 
                            variant="primary" 
                            size="full" 
                            onClick={handleReset} 
                            className="shadow-lg flex items-center gap-3"
                        >
                            <RotateCcw size={20} />
                            새로운 환자 입력하기
                        </ModernButton>
                    </div>
                 </div>
              ) : null}
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
};
