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
  ChevronDown
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
  routeFromKTAS,
  routeNearest,
  RoutingCandidateResponse,
  RoutingCandidateHospital,
  predictAudio,
  predictText,
} from '../utils/api';
import { useRef } from 'react';

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
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const [awaitingLocation, setAwaitingLocation] = useState(false);
  const [openHospitalId, setOpenHospitalId] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const recordTimeoutRef = useRef<number | null>(null);
  const locationFallbackTimeoutRef = useRef<number | null>(null);
  const nearestRequestInFlightRef = useRef(false);
  const lastNearestRequestKeyRef = useRef<string | null>(null);
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
    if (symptom.includes("가슴") || symptom.includes("흉통") || symptom.includes("chest")) return "chest_pain";
    if (symptom.includes("호흡") || symptom.includes("숨") || symptom.includes("resp")) return "dyspnea";
    if (symptom.includes("신경") || symptom.includes("편마비") || symptom.includes("경련") || symptom.includes("stroke")) return "neuro";
    if (symptom.includes("복통") || symptom.includes("소화") || symptom.includes("abdominal") || symptom.includes("배")) return "abdominal";
    if (symptom.includes("출혈") || symptom.includes("bleed")) return "bleeding";
    if (symptom.includes("의식") || symptom.includes("altered") || symptom.includes("syncope")) return "altered";
    if (symptom.includes("외상") || symptom.includes("trauma") || symptom.includes("사고") || symptom.includes("골절") || symptom.includes("화상")) return "trauma";
    if (symptom.includes("산부인") || symptom.includes("ob") || symptom.includes("preg")) return "obgyn";
    if (symptom.includes("소아") || symptom.includes("pediatric") || symptom.includes("아이")) return "pediatric";
    if (symptom.includes("정신") || symptom.includes("psy")) return "psychiatric";
    return null;
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

  // Fetch backend recommendations (base)
  const fetchBackendHospitals = useCallback(async (options?: { deferRender?: boolean }) => {
    if (!patientData.ktasLevel || !patientData.symptoms.trim()) {
      setHospitals([]);
      setRoutingResponse(null);
      return;
    }

    setIsLoadingHospitals(true);
    try {
      const cc = mapSymptomToChiefComplaintCode(patientData.symptoms);
      const base = await routeFromKTAS({
        ktas_level: patientData.ktasLevel,
        chief_complaint: cc || patientData.symptoms,
        hospital_followup: patientData.existingHospital || undefined,
        user_lat: userLocation?.lat,
        user_lon: userLocation?.lon,
        min_valid_hospitals: 3,
      });

      setRoutingResponse(base);
      if (!options?.deferRender) {
        setHospitals(base.hospitals.slice(0, 3).map(mapToHospital));
      }
    } catch (err) {
      console.error('Error fetching recommendations:', err);
      setHospitals([]);
      setRoutingResponse(null);
    } finally {
      setIsLoadingHospitals(false);
    }
  }, [mapSymptomToChiefComplaintCode, mapToHospital, patientData.existingHospital, patientData.ktasLevel, patientData.symptoms, userLocation]);

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

  // Request geolocation when entering list view (best-effort). If granted, wait for nearest before rendering.
  useEffect(() => {
    if (view !== 'list' || locationRequested) return;
    if (!('geolocation' in navigator)) {
      setLocationRequested(true);
      fetchBackendHospitals();
      return;
    }
    setLocationRequested(true);
    setAwaitingLocation(true);
    setIsLoadingHospitals(true);

    // Permission prompt can hang indefinitely; fall back to base routing after the same
    // window we give geolocation itself, so we do not discard a valid position too early.
    locationFallbackTimeoutRef.current = window.setTimeout(async () => {
      console.warn('Geolocation fallback timeout reached; fetching base recommendations without coordinates');
      setAwaitingLocation(false);
      await fetchBackendHospitals();
    }, 15000);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        clearLocationFallbackTimeout();
        setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        try {
          const base = await routeFromKTAS({
            ktas_level: patientData.ktasLevel ?? 0,
            chief_complaint: mapSymptomToChiefComplaintCode(patientData.symptoms) || patientData.symptoms,
            hospital_followup: patientData.existingHospital || undefined,
            user_lat: pos.coords.latitude,
            user_lon: pos.coords.longitude,
            min_valid_hospitals: 3,
          });

          const nearest = await refineRoutingWithNearest(
            base,
            pos.coords.latitude,
            pos.coords.longitude,
          );
          if (!nearest || !nearest.hospitals?.length) {
            setRoutingResponse(base);
            setHospitals(base.hospitals.slice(0, 3).map(mapToHospital));
          }
        } catch (err) {
          console.warn('Geolocation fetch failed, falling back to base list', err);
          await fetchBackendHospitals();
        } finally {
          setIsLoadingHospitals(false);
          setAwaitingLocation(false);
        }
      },
      async (err) => {
        clearLocationFallbackTimeout();
        console.warn('Geolocation error', err);
        setAwaitingLocation(false);
        await fetchBackendHospitals();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );

    return () => {
      clearLocationFallbackTimeout();
    };
  }, [fetchBackendHospitals, mapSymptomToChiefComplaintCode, mapToHospital, patientData.existingHospital, patientData.ktasLevel, patientData.symptoms, view, locationRequested]);

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
    setRoutingResponse(result);
    const vitals = result.stt_vitals || {};
    const avpu = (vitals as any).avpu || (vitals as any).AVPU;
    const rr = (vitals as any).rr ?? (vitals as any).RR;
    const bpSys = (vitals as any).bp_sys ?? (vitals as any).BP_sys ?? (vitals as any).BP_SYS;
    const bpDia = (vitals as any).bp_dia ?? (vitals as any).BP_dia ?? (vitals as any).BP_DIA;
    const hr = (vitals as any).hr ?? (vitals as any).HR;
    const bt = (vitals as any).bt ?? (vitals as any).BT;
    setPatientData((prev) => ({
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
      temperature: bt != null ? String(bt) : prev.temperature,
    }));
    if (result.case?.ktas != null) {
      setKtasLocked(true);
    }
    if (result.hospitals?.length) {
      setHospitals(result.hospitals.slice(0, 3).map(mapToHospital));
    }
  }, [mapToHospital]);

  const handleVoiceInput = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("이 브라우저에서는 음성 녹음이 지원되지 않습니다.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          mediaChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        setIsListening(false);
        const blob = new Blob(mediaChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());

        setIsProcessingVoice(true);
        try {
          const formData = new FormData();
          formData.append("audio", blob, "recording.webm");

          const result = await predictAudio(formData);
          applyBackendResult(result);
          setView("review");
        } catch (err) {
          console.error("음성 전송 실패:", err);
          alert("음성 인식에 실패했습니다. 다시 시도해 주세요.");
        } finally {
          setIsProcessingVoice(false);
        }
        recordTimeoutRef.current = null;
      };

      recorder.start();
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

    // 1. Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
    
    // 2. Create Transfer Request in DB
    const { data, error } = await supabase
        .from('transfer_requests')
        .insert({
            hospital_id: hospital.id,
            paramedic_id: user?.id, 
            patient_age: 45, // Mock
            patient_gender: 'Male', // Mock
            symptoms: patientData.symptoms,
            ktas_level: patientData.ktasLevel,
            vitals_bp: patientData.bloodPressure,
            vitals_resp: parseInt(patientData.respiration || '0'),
            vitals_pulse: parseInt(patientData.pulse || '0'),
            status: 'waiting'
        })
        .select()
        .single();

    if (error) {
        console.error("Supabase insert error:", error);
        // Fallback simulation for demo if DB isn't set up
        setTimeout(() => {
            setRequestStatus('approved');
        }, 2500);
    } else if (data) {
        setCurrentRequestId(data.id);
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
    setHospitals([]);
    setUserLocation(null);
    setLocationRequested(false);
    setAwaitingLocation(false);
    lastNearestRequestKeyRef.current = null;
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
      temperature: '',
      symptoms: '',
      existingHospital: '',
      ktasLevel: null
    });
    setSelectedHospital(null);
    setRequestStatus('waiting');
    setCurrentRequestId(null);
  };

  const clearLocationFallbackTimeout = () => {
    if (locationFallbackTimeoutRef.current) {
      clearTimeout(locationFallbackTimeoutRef.current);
      locationFallbackTimeoutRef.current = null;
    }
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
                          const report = `환자 보고: ${patientInfo.age || ''}세 ${genderText} 환자. 이름: ${patientInfo.name || '정보 없음'}. 생년월일: ${patientInfo.birthdate || '정보 없음'}. 주증상: ${patientData.symptoms}. 의식: ${patientData.consciousness}. 호흡수: ${patientData.respiration || '정보 없음'}. 맥박: ${patientData.pulse || '정보 없음'}. 혈압: ${patientData.bloodPressure || '정보 없음'}. 체온: ${patientData.temperature || '정보 없음'}. 평소 병원: ${patientData.existingHospital || '정보 없음'}.`;
                          const result = await predictText(report);
                          applyBackendResult(result);
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
                      <p className="text-sm text-gray-500 font-bold mb-1">호흡수</p>
                      <p className="text-2xl font-black text-gray-800">{patientData.respiration || "-"}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      <p className="text-sm text-gray-500 font-bold mb-1">혈압</p>
                      <p className="text-2xl font-black text-gray-800">{patientData.bloodPressure || "-"}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                      <p className="text-sm text-gray-500 font-bold mb-1">맥박</p>
                      <p className="text-2xl font-black text-gray-800">{patientData.pulse || "-"}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-xl p-4 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)] col-span-2">
                      <p className="text-sm text-gray-500 font-bold mb-1">체온</p>
                      <p className="text-2xl font-black text-gray-800">{patientData.temperature || "-"}</p>
                    </div>
                  </div>
                </div>
              </ModernCard>

              <div className="mt-8 flex gap-3">
                <ModernButton
                  variant="primary"
                  size="full"
                  onClick={() => setView('list')}
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
                    {hospitals.map((hospital, idx) => (
                    <ModernCard 
                        key={hospital.id} 
                        // Make the entire card clickable
                        onClick={() => handleHospitalSelect(hospital)}
                        className={cn(
                            "group active:scale-[0.98] transition-all relative overflow-hidden border-2 cursor-pointer shadow-md hover:shadow-xl",
                            idx === 0 ? "border-yellow-400 bg-yellow-50/50" :
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
                                className="flex items-center gap-1 text-xs font-bold text-[#00796B] hover:text-[#005f56]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenHospitalId((prev) => prev === hospital.id ? null : hospital.id);
                                }}
                              >
                                상세 보기
                                <ChevronDown
                                  size={14}
                                  className={cn(
                                    "transition-transform",
                                    openHospitalId === hospital.id ? "rotate-180" : ""
                                  )}
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

                            {/* Request Button (Visual only since card is clickable, but helpful affordance) */}
                            <div className="flex-1 h-16 bg-blue-600 rounded-2xl flex items-center justify-between px-6 text-white shadow-lg border-2 border-blue-700 group-active:bg-blue-700 transition-colors">
                                <span className="text-xl font-black">수송 요청 보내기</span>
                                <div className="bg-white/20 p-2 rounded-full">
                                    <ChevronRight size={24} className="group-hover:translate-x-1 transition-transform" />
                                </div>
                            </div>
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
