import React, { useState, useEffect } from 'react';
import {
  LogOut, Clock, CheckCircle2, XCircle, Activity, Heart,
  Thermometer, Brain, Loader2, AlertTriangle, Building2,
  ChevronDown, AlertCircle, Phone, ChevronLeft, User,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './ui/DesignSystem';
import { HospitalRequest } from '../types';
import { supabase } from '../utils/supabase/client';

interface ERTabletDashboardProps {
  onLogout: () => void;
}

type TabType = 'dash' | 'patients' | 'status';

// ── 데모 모드 감지 ─────────────────────────────────────────
const demoAuthEnabled = Boolean((import.meta as any)?.env?.VITE_DEMO_AUTH);

// ── 데모용 목업 환자 데이터 ────────────────────────────────
// TODO: 실제 서비스 시 Supabase 또는 FastAPI /api/transfer-requests 로 교체
const DEMO_REQUESTS: HospitalRequest[] = [
  {
    id: 'demo-1', ktasLevel: 1, consciousness: 'Unresponsive',
    symptoms: '의식 변화 (Altered Mental Status)',
    eta: 5, paramedicUnit: '서울 강남소방서', paramedicName: '김○○ 대원',
    timestamp: new Date(), status: 'pending',
    patientData: { consciousness: 'Unresponsive', respiration: '18', bloodPressure: '80/50', pulse: '120', temperature: '36.8', symptoms: '의식 변화', ktasLevel: 1 },
  },
  {
    id: 'demo-2', ktasLevel: 1, consciousness: 'Alert',
    symptoms: '가슴 통증 (Chest Pain)',
    eta: 12, paramedicUnit: '서울 송파소방서', paramedicName: '이○○ 대원',
    timestamp: new Date(), status: 'pending',
    patientData: { consciousness: 'Alert', respiration: '20', bloodPressure: '110/70', pulse: '98', temperature: '36.5', symptoms: '가슴 통증', ktasLevel: 1 },
  },
  {
    id: 'demo-3', ktasLevel: 2, consciousness: 'Alert',
    symptoms: '호흡 곤란 (Dyspnea)',
    eta: 8, paramedicUnit: '서울 관악소방서', paramedicName: '박○○ 대원',
    timestamp: new Date(), status: 'pending',
    patientData: { consciousness: 'Alert', respiration: '28', bloodPressure: '90/60', pulse: '104', temperature: '37.1', symptoms: '호흡 곤란', ktasLevel: 2 },
  },
  {
    id: 'demo-4', ktasLevel: 3, consciousness: 'Alert',
    symptoms: '외상 (Trauma) — 교통사고',
    eta: 18, paramedicUnit: '서울 마포소방서', paramedicName: '최○○ 대원',
    timestamp: new Date(), status: 'pending',
    patientData: { consciousness: 'Alert', respiration: '16', bloodPressure: '128/82', pulse: '88', temperature: '36.6', symptoms: '외상', ktasLevel: 3 },
  },
  {
    id: 'demo-5', ktasLevel: 3, consciousness: 'Alert',
    symptoms: '복통 (Abdominal Pain)',
    eta: 22, paramedicUnit: '서울 영등포소방서', paramedicName: '정○○ 대원',
    timestamp: new Date(), status: 'pending',
    patientData: { consciousness: 'Alert', respiration: '17', bloodPressure: '118/76', pulse: '92', temperature: '37.4', symptoms: '복통', ktasLevel: 3 },
  },
];

// ── KTAS 색상 ──────────────────────────────────────────────
const KTAS_STYLE: Record<number, { bg: string; etaColor: string }> = {
  1: { bg: '#dc2626', etaColor: '#dc2626' },
  2: { bg: '#ea580c', etaColor: '#ea580c' },
  3: { bg: '#ca8a04', etaColor: '#ca8a04' },
  4: { bg: '#16a34a', etaColor: '#16a34a' },
  5: { bg: '#2563eb', etaColor: '#2563eb' },
};

// ── 목업 병상·인력 데이터 ──────────────────────────────────
// TODO: 실제 서비스 시 FastAPI /api/hospitals/realtime 로 교체
const BED_SERVICES = [
  { name: '응급일반',   available: 15, total: 22 },
  { name: '응급조사',   available: 0,  total: 2  },
  { name: '분만실',     available: 3,  total: 3  },
  { name: '음압격리',   available: 1,  total: 1  },
  { name: '일반격리',   available: 2,  total: 3  },
  { name: '코호트격리', available: 0,  total: 6  },
];
// TODO: 실제 서비스 시 Supabase 수락된 transfer_requests 목록으로 교체
const RECENTLY_ACCEPTED = [
  { name: '박○○', age: 72, gender: '남', diagnosis: '복통',     ktas: 2, time: '14:18' },
  { name: '이○○', age: 45, gender: '여', diagnosis: '호흡곤란', ktas: 2, time: '13:52' },
  { name: '최○○', age: 58, gender: '남', diagnosis: '흉통',     ktas: 1, time: '13:31' },
];
const REJECTION_REASONS = ['병상 부족 (ER Full)', '전문 의료진 부재', '수술실/장비 부족', 'ICU 병상 부족', '기타 사유'];

// ── KTAS 레벨 이름 ──────────────────────────────────────────
const KTAS_NAMES: Record<number, string> = {
  1: '소생 (Resuscitation)',
  2: '긴급 (Emergent)',
  3: '응급 (Urgent)',
  4: '준응급 (Less Urgent)',
  5: '비응급 (Non-urgent)',
};

// ── 환자별 추가 데모 데이터 (나이·성별·추가 소견·SpO2) ────────
// TODO: 실제 서비스 시 transfer_requests 테이블 컬럼 또는 API 응답으로 교체
const DEMO_EXTRA: Record<string, { age: number; gender: string; note: string; spo2: number }> = {
  'demo-1': { age: 65, gender: '남성', note: '심정지 의심, 심폐소생술 시행 중', spo2: 88 },
  'demo-2': { age: 58, gender: '남성', note: '흉통 10/10, 좌측 방사통, 발한 동반', spo2: 96 },
  'demo-3': { age: 72, gender: '여성', note: '산소포화도 저하, 양측 천명음', spo2: 82 },
  'demo-4': { age: 34, gender: '남성', note: '다발성 열상 및 타박상, 경추 고정 조치', spo2: 98 },
  'demo-5': { age: 45, gender: '여성', note: '우하복부 통증, 반동 압통 있음', spo2: 99 },
};

// ── 병상 바 컴포넌트 ───────────────────────────────────────
function BedBar({ name, available, total }: { name: string; available: number; total: number }) {
  const pct    = total > 0 ? (available / total) * 100 : 0;
  const isFull = available === 0;
  const isWarn = pct < 50 && !isFull;
  const barColor  = isFull ? '#ef4444' : isWarn ? '#f97316' : '#22c55e';
  const textColor = isFull ? '#dc2626' : isWarn ? '#ea580c' : '#1e293b';
  const badgeBg   = isFull ? '#fee2e2' : isWarn ? '#fef3c7' : '#dcfce7';
  const badgeText = isFull ? '#dc2626' : isWarn ? '#92400e' : '#15803d';

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f8fafc', gap: 8 }}>
      <span style={{ fontSize: 12, color: '#1e293b', width: 72, flexShrink: 0 }}>{name}</span>
      <div style={{ flex: 1, height: 5, background: '#f1f5f9', borderRadius: 3 }}>
        <div style={{ height: 5, background: barColor, borderRadius: 3, width: `${pct}%` }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: textColor, minWidth: 36, textAlign: 'right' }}>
        {available}/{total}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: badgeBg, color: badgeText, minWidth: 32, textAlign: 'center' }}>
        {isFull ? '포화' : isWarn ? '여유' : '정상'}
      </span>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────
export const ERTabletDashboard: React.FC<ERTabletDashboardProps> = ({ onLogout }) => {
  const [activeTab,       setActiveTab]       = useState<TabType>('dash');
  // 이송 요청 대기 (수락 전 pending 상태)
  const [requests,        setRequests]        = useState<HospitalRequest[]>(DEMO_REQUESTS);
  // 수락된 환자 (이송 중 → 대기 환자 탭에 표시)
  const [accepted,        setAccepted]        = useState<HospitalRequest[]>([]);
  const [rejectModal,     setRejectModal]     = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<HospitalRequest | null>(null);
  const [isLoading,       setIsLoading]       = useState(false);
  const [currentTime,     setCurrentTime]     = useState('');
  const [ktasFilter,      setKtasFilter]      = useState<'all' | '1-2'>('all');

  // 시계
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  // 데이터 패치
  useEffect(() => {
    // 데모 모드 → 목업 데이터 사용
    if (demoAuthEnabled) {
      setRequests(DEMO_REQUESTS);
      return;
    }

    let cleanup: (() => void) | undefined;
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const { data: hospData } = await supabase
          .from('hospitals').select('id').eq('name', '서울대학교병원').single();
        if (!hospData) { setIsLoading(false); return; }

        const { data: reqData } = await supabase
          .from('transfer_requests').select('*')
          .eq('hospital_id', hospData.id).eq('status', 'waiting')
          .order('created_at', { ascending: false });

        if (reqData) setRequests(reqData.map(mapRow));
        setIsLoading(false);

        const channel = supabase.channel('er-tablet')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transfer_requests', filter: `hospital_id=eq.${hospData.id}` },
            (payload) => setRequests(prev => [mapRow(payload.new), ...prev]))
          .subscribe();
        cleanup = () => { supabase.removeChannel(channel); };
      } catch {
        setIsLoading(false);
      }
    };
    fetchData();
    return () => { cleanup?.(); };
  }, []);

  const mapRow = (r: any): HospitalRequest => ({
    id: r.id, ktasLevel: r.ktas_level, consciousness: r.consciousness || 'Alert',
    symptoms: r.symptoms, eta: 10, paramedicUnit: '119 구급대',
    paramedicName: r.paramedic_name || '대원', timestamp: new Date(r.created_at), status: r.status,
    patientData: {
      consciousness: r.consciousness || 'Alert', respiration: r.vitals_resp?.toString() || '-',
      bloodPressure: r.vitals_bp || '-', pulse: r.vitals_pulse?.toString() || '-',
      temperature: r.vitals_temp?.toString() || '36.5', symptoms: r.symptoms, ktasLevel: r.ktas_level,
    },
  });

  const handleApprove = async (id: string) => {
    const req = requests.find(r => r.id === id);
    if (req) {
      setRequests(prev => prev.filter(r => r.id !== id));
      setAccepted(prev => [{ ...req, status: 'accepted' as const }, ...prev]);
    }
    setSelectedRequest(null);
    setActiveTab('patients'); // 수락 후 대기 환자 탭으로 이동
    if (!demoAuthEnabled) {
      await supabase.from('transfer_requests').update({ status: 'approved' }).eq('id', id);
    }
  };
  const handleReject = async (id: string, reason: string) => {
    setRequests(prev => prev.filter(r => r.id !== id));
    setRejectModal(null);
    setSelectedRequest(null); // 상세 뷰가 열려있으면 닫기
    if (!demoAuthEnabled) {
      await supabase.from('transfer_requests').update({ status: 'rejected', rejection_reason: reason }).eq('id', id);
    }
  };

  // 집계
  const criticalCount  = requests.filter(r => r.ktasLevel <= 2).length;
  const acceptedCount  = accepted.length;
  const totalAvailable = BED_SERVICES.reduce((s, b) => s + b.available, 0);
  const totalBeds      = BED_SERVICES.reduce((s, b) => s + b.total,     0);
  const filteredAccepted = ktasFilter === '1-2' ? accepted.filter(r => r.ktasLevel <= 2) : accepted;
  const ktasCounts     = [1,2,3,4,5].map(k => ({ level: k, count: accepted.filter(r => r.ktasLevel === k).length }));
  const maxKtas        = Math.max(...ktasCounts.map(k => k.count), 1);

  // ── 환자 상세 뷰 ──────────────────────────────────────
  const PatientDetail = ({ req }: { req: HospitalRequest }) => {
    const ktas  = KTAS_STYLE[req.ktasLevel] ?? KTAS_STYLE[3];
    const extra = DEMO_EXTRA[req.id] ?? { age: 45, gender: '미상', note: '-', spo2: 98 };
    const bp    = req.patientData.bloodPressure;
    const hr    = req.patientData.pulse;
    const rr    = req.patientData.respiration;

    return (
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 45,
          background: '#f8fafc', overflowY: 'auto',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* 헤더 */}
        <div style={{
          background: '#fff', borderBottom: '1px solid #e2e8f0',
          padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
          position: 'sticky', top: 0, zIndex: 1,
        }}>
          <button
            onClick={() => setSelectedRequest(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: '#1e293b', display: 'flex', alignItems: 'center', borderRadius: 8 }}
          >
            <ChevronLeft size={22} />
          </button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>환자 상세 정보</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Patient Details</div>
          </div>
        </div>

        <div style={{ padding: '16px', maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* KTAS 배너 */}
          <div style={{
            background: ktas.bg, borderRadius: 14, padding: '16px 20px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} color="rgba(255,255,255,0.9)" />
                <span style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>KTAS Level {req.ktasLevel}</span>
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4 }}>
                {KTAS_NAMES[req.ktasLevel]}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700, color: '#fff' }}>
              <Clock size={15} /> {req.eta}분 후
            </div>
          </div>

          {/* 환자 정보 */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 14 }}>
              <User size={14} /> 환자 정보
            </div>
            {[
              { label: '나이 / Age',    value: `${extra.age}세` },
              { label: '성별 / Gender', value: extra.gender },
              { label: '의식 수준',     value: req.consciousness },
            ].map((row, i, arr) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '9px 0', borderBottom: i < arr.length - 1 ? '1px solid #f1f5f9' : 'none',
              }}>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{row.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* 주 증상 */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 12 }}>
              <AlertCircle size={14} /> 주 증상 / 진단
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 6 }}>{req.symptoms}</div>
            <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{extra.note}</div>
          </div>

          {/* 활력징후 */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 14 }}>
              <Activity size={14} /> 활력징후 / Vital Signs
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: '혈압 (BP)',          value: bp,              unit: 'mmHg',        warn: bp !== '-' && parseInt(bp) < 90 },
                { label: '심박수 (HR)',         value: hr,              unit: 'bpm',         warn: Number(hr) > 100 || Number(hr) < 50 },
                { label: '호흡수 (RR)',         value: rr,              unit: 'breaths/min', warn: Number(rr) > 24 || Number(rr) < 10 },
                { label: '산소포화도 (SpO₂)',   value: `${extra.spo2}%`, unit: 'oxygen',     warn: extra.spo2 < 90 },
              ].map((v, i) => (
                <div key={i} style={{
                  background: v.warn ? '#fef2f2' : '#f8fafc',
                  border: v.warn ? '1px solid #fecaca' : '1px solid transparent',
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  <div style={{ fontSize: 11, color: v.warn ? '#ef4444' : '#94a3b8', marginBottom: 4 }}>{v.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: v.warn ? '#dc2626' : '#1e293b', lineHeight: 1 }}>{v.value}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>{v.unit}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 출발지 */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 12 }}>출발지 / Location</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, background: '#eff6ff', borderRadius: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Phone size={18} color="#3b82f6" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                  {req.paramedicUnit} · {req.paramedicName}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>구급차 연락처: 119</div>
              </div>
            </div>
          </div>

          {/* 처리 지침 */}
          <div style={{
            background: '#eff6ff', border: '1px solid #bfdbfe',
            borderRadius: 14, padding: '14px 16px',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <AlertCircle size={16} color="#3b82f6" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: '#1d4ed8', lineHeight: 1.65 }}>
              응급 환자 이송 요청을 신중히 검토하고, 병상 가용성과 환자 중증도를 고려하여 승인 또는 거절 결정을 내려주세요.
            </div>
          </div>

          {/* 액션 버튼 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, paddingBottom: 24 }}>
            <button
              onClick={() => setRejectModal(req.id)}
              style={{
                padding: '14px', borderRadius: 12, border: '2px solid #fecaca',
                background: '#fff', color: '#ef4444', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <XCircle size={16} /> 거절 (NO)
            </button>
            <button
              onClick={() => handleApprove(req.id)}
              style={{
                padding: '14px', borderRadius: 12, border: 'none',
                background: '#16a34a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <CheckCircle2 size={16} /> 수락 (YES)
            </button>
          </div>

        </div>
      </motion.div>
    );
  };

  // ── 환자 카드 ─────────────────────────────────────────
  const PatientCard = ({ req }: { req: HospitalRequest }) => {
    const ktas = KTAS_STYLE[req.ktasLevel] ?? KTAS_STYLE[3];
    const bp   = req.patientData.bloodPressure;
    const hr   = req.patientData.pulse;
    const bpWarn = bp !== '-' && (() => { const sys = parseInt(bp); return sys < 90 || sys > 160; })();
    const hrWarn = hr !== '-' && (Number(hr) > 100 || Number(hr) < 50);

    return (
      <div
        onClick={() => setSelectedRequest(req)}
        style={{
          background: req.ktasLevel === 1 ? '#fff9f9' : '#fff',
          border: `1px solid ${req.ktasLevel === 1 ? '#fecaca' : '#e2e8f0'}`,
          borderRadius: 10, padding: '12px 14px', marginBottom: 8,
          cursor: 'pointer', transition: 'box-shadow 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
      >
        {/* 상단: KTAS + ETA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ background: ktas.bg, color: '#fff', borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}>
            KTAS {req.ktasLevel}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: ktas.etaColor }}>
            <Clock size={11} /> {req.eta}분 후 도착
          </span>
          {req.ktasLevel === 1 && (
            <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>
              즉시 대응 필요
            </span>
          )}
        </div>

        {/* 증상 + 출동 구급대 */}
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>{req.symptoms}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
          <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, marginRight: 4, fontSize: 11 }}>출동 구급대</span>
          {req.paramedicUnit} · {req.paramedicName}
        </div>

        {/* 바이탈 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {[
            { icon: <Activity size={10} />, label: `BP ${bp}`,  warn: bpWarn },
            { icon: <Heart size={10} />,    label: `HR ${hr}`,  warn: hrWarn },
            { icon: <Thermometer size={10} />, label: `${req.patientData.temperature}°C`, warn: false },
            { icon: <Brain size={10} />,    label: req.consciousness, warn: false },
          ].map((v, i) => (
            <span key={i} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: v.warn ? '#fef2f2' : '#f1f5f9',
              color: v.warn ? '#dc2626' : '#475569',
              borderRadius: 5, padding: '4px 8px', fontSize: 10,
            }}>
              {v.icon} {v.label}
            </span>
          ))}
        </div>

        {/* 버튼 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setRejectModal(req.id); }}
            style={{ padding: 9, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = '#fef2f2'; (e.target as HTMLElement).style.borderColor = '#ef4444'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = '#fff';    (e.target as HTMLElement).style.borderColor = '#e2e8f0'; }}
          >
            <XCircle size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            거절 (NO)
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleApprove(req.id); }}
            style={{ padding: 9, borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = '#15803d'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = '#16a34a'; }}
          >
            <CheckCircle2 size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            수락 (YES)
          </button>
        </div>
      </div>
    );
  };

  // ── 수락된 환자 카드 (대기 환자 탭용) ────────────────────
  const AcceptedCard = ({ req }: { req: HospitalRequest }) => {
    const ktas = KTAS_STYLE[req.ktasLevel] ?? KTAS_STYLE[3];
    return (
      <div style={{
        background: '#f0fdf4', border: '1px solid #bbf7d0',
        borderRadius: 10, padding: '12px 14px', marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ background: ktas.bg, color: '#fff', borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}>
            KTAS {req.ktasLevel}
          </span>
          <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>
            ✓ 수락됨 · 이송 중
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: ktas.etaColor, marginLeft: 'auto' }}>
            <Clock size={11} /> {req.eta}분 후 도착
          </span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>{req.symptoms}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
          <span style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, marginRight: 4, fontSize: 11 }}>출동 구급대</span>
          {req.paramedicUnit} · {req.paramedicName}
        </div>
        <button
          onClick={() => setAccepted(prev => prev.filter(r => r.id !== req.id))}
          style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #bbf7d0', background: '#fff', color: '#16a34a', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#dcfce7'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; }}
        >
          <CheckCircle2 size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
          도착 완료 처리
        </button>
      </div>
    );
  };

  // ── 사이드 패널 ───────────────────────────────────────
  const SidePanel = () => (
    <div style={{ width: 220, borderLeft: '1px solid #e2e8f0', background: '#fff', overflowY: 'auto', flexShrink: 0 }}>
      {/* 병상 서비스 현황 */}
      <div style={{ borderBottom: '1px solid #f1f5f9', padding: '12px 14px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>병상 서비스 현황</div>
        {BED_SERVICES.map(b => <BedBar key={b.name} {...b} />)}
      </div>
      {/* 수락된 환자 (이송 중) */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>수락된 환자</div>
          {acceptedCount > 0 && (
            <span style={{ background: '#16a34a', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px' }}>
              {acceptedCount}
            </span>
          )}
        </div>
        {accepted.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>수락된 환자 없음</div>
        ) : (
          accepted.map((req) => {
            const extra = DEMO_EXTRA[req.id];
            const timeStr = `${String(req.timestamp.getHours()).padStart(2,'0')}:${String(req.timestamp.getMinutes()).padStart(2,'0')}`;
            return (
              <div key={req.id} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 12px', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>
                    {extra ? `${extra.age}세 ${extra.gender}` : '환자'}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{req.symptoms.split(' ')[0]} · KTAS {req.ktasLevel}</div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#16a34a' }}>{timeStr}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // ── 렌더 ─────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f0f4f8', fontFamily: 'system-ui, sans-serif', color: '#1e293b', overflow: 'hidden' }}>

      {/* 탑바 */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
            <span style={{ background: '#1e293b', color: '#fff', fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 5, letterSpacing: '0.08em' }}>VITAL</span>
            <Building2 size={16} color="#64748b" />
            응급실 대시보드
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            서울대학교병원 응급실 · 실시간 연동 중
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={13} /> {currentTime}
          </span>
          {criticalCount > 0 && (
            <span style={{ fontSize: 12, background: '#fee2e2', color: '#dc2626', padding: '3px 10px', borderRadius: 6, fontWeight: 600 }}>
              응급 알림 {criticalCount}건
            </span>
          )}
          <button onClick={onLogout} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#94a3b8' }}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* 탭 네비 */}
      <nav style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', flexShrink: 0 }}>
        {(['dash', 'patients', 'status'] as TabType[]).map((tab, i) => {
          const labels = ['대시보드', '대기 환자', '병원 현황'];
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                border: 'none', borderBottom: `2px solid ${isActive ? '#1e293b' : 'transparent'}`,
                background: 'none', color: isActive ? '#1e293b' : '#94a3b8',
                transition: 'all 0.15s',
              }}
            >
              {labels[i]}
              {tab === 'dash' && requests.length > 0 && (
                <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px' }}>
                  {requests.length}
                </span>
              )}
              {tab === 'patients' && acceptedCount > 0 && (
                <span style={{ marginLeft: 6, background: '#16a34a', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px' }}>
                  {acceptedCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 탭 콘텐츠 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>

        {/* ════ 대시보드 탭 ════ */}
        {activeTab === 'dash' && (
          <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>

              {/* 통계 카드 4개 - 인라인 스타일로 강제 4열 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>

                {/* 전체 가용 병상 */}
                <div style={{ background: '#16a34a', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#bbf7d0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>전체 가용 병상</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
                    <span style={{ fontSize: 26, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>{totalAvailable}</span>
                    <span style={{ fontSize: 14, color: '#bbf7d0', fontWeight: 500 }}>/ {totalBeds}개</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.25)', borderRadius: 2, marginTop: 6 }}>
                    <div style={{ height: 4, background: '#fff', borderRadius: 2, width: `${(totalAvailable / totalBeds) * 100}%` }} />
                  </div>
                  <div style={{ fontSize: 10, color: '#bbf7d0', marginTop: 2 }}>
                    가용률 {Math.round((totalAvailable / totalBeds) * 100)}%
                  </div>
                </div>

                {/* 응급병상 */}
                <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>응급병상</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', lineHeight: 1.1, marginTop: 2 }}>
                    {BED_SERVICES[0].available}
                    <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 400 }}>/{BED_SERVICES[0].total}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginTop: 6 }}>
                    {BED_SERVICES.slice(1, 4).map(b => (
                      <div key={b.name} style={{ fontSize: 10, color: '#64748b' }}>
                        {b.name}
                        <span style={{ display: 'block', fontWeight: 600, color: b.available === 0 ? '#ef4444' : '#1e293b', fontSize: 13 }}>
                          {b.available}/{b.total}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 이송 요청 대기 */}
                <div style={{ background: '#fff', borderRadius: 10, border: `1px solid ${requests.length > 0 ? '#fecaca' : '#e2e8f0'}`, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>이송 요청 대기</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: requests.length > 0 ? '#ef4444' : '#1e293b', lineHeight: 1.1, marginTop: 2 }}>
                    {requests.length}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                    KTAS 1·2: <span style={{ color: '#dc2626', fontWeight: 600 }}>{criticalCount}명</span>
                  </div>
                </div>

                {/* 수락된 환자 (이송 중) */}
                <div style={{ background: '#fff', borderRadius: 10, border: `1px solid ${acceptedCount > 0 ? '#bbf7d0' : '#e2e8f0'}`, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>수락됨 · 이송 중</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: acceptedCount > 0 ? '#16a34a' : '#1e293b', lineHeight: 1.1, marginTop: 2 }}>
                    {acceptedCount}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>도착 대기 중인 환자</div>
                </div>
              </div>

              {/* 이송 요청 헤더 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <AlertTriangle size={13} />
                  이송 요청 대기
                  {requests.length > 0 && (
                    <span style={{ background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px' }}>
                      {requests.length}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setActiveTab('patients')}
                  style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  전체 보기 →
                </button>
              </div>

              {/* 환자 카드 목록 */}
              {isLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                  <Loader2 className="animate-spin" size={24} color="#94a3b8" />
                </div>
              ) : requests.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', color: '#94a3b8' }}>
                  <CheckCircle2 size={40} color="#cbd5e1" style={{ marginBottom: 8 }} />
                  <p style={{ fontSize: 14, fontWeight: 500 }}>대기 중인 이송 요청이 없습니다</p>
                </div>
              ) : (
                <AnimatePresence>
                  {requests.map(req => (
                    <motion.div key={req.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} layout>
                      <PatientCard req={req} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
            <SidePanel />
          </div>
        )}

        {/* ════ 대기 환자 탭 (수락 후 이송 중인 환자) ════ */}
        {activeTab === 'patients' && (
          <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>

              {/* 섹션 헤더 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                <CheckCircle2 size={13} color="#16a34a" />
                수락됨 · 이송 중
                {acceptedCount > 0 && (
                  <span style={{ background: '#16a34a', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 7px' }}>
                    {acceptedCount}
                  </span>
                )}
              </div>

              {/* 필터 */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {[
                  { key: 'all',  label: `전체 (${acceptedCount})` },
                  { key: '1-2', label: `KTAS 1·2 (${accepted.filter(r => r.ktasLevel <= 2).length})` },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => setKtasFilter(f.key as 'all' | '1-2')}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer', fontWeight: 500,
                      background: ktasFilter === f.key ? '#1e293b' : '#fff',
                      color:      ktasFilter === f.key ? '#fff' : '#64748b',
                      border:     ktasFilter === f.key ? '1px solid #1e293b' : '1px solid #e2e8f0',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {filteredAccepted.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', color: '#94a3b8' }}>
                  <CheckCircle2 size={40} color="#cbd5e1" style={{ marginBottom: 10 }} />
                  <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>이송 중인 환자가 없습니다</p>
                  <p style={{ fontSize: 12 }}>이송 요청을 수락하면 여기에 표시됩니다</p>
                </div>
              ) : (
                <AnimatePresence>
                  {filteredAccepted.map(req => (
                    <motion.div key={req.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} layout>
                      <AcceptedCard req={req} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* 오른쪽 사이드: KTAS 현황 + 병상 */}
            <div style={{ width: 220, borderLeft: '1px solid #e2e8f0', background: '#fff', overflowY: 'auto', flexShrink: 0 }}>
              <div style={{ borderBottom: '1px solid #f1f5f9', padding: '12px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>KTAS별 현황</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ktasCounts.map(({ level, count }) => (
                    <div key={level} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ background: KTAS_STYLE[level].bg, color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, minWidth: 56, textAlign: 'center' }}>
                        KTAS {level}
                      </span>
                      <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4 }}>
                        <div style={{ height: 8, background: KTAS_STYLE[level].bg, borderRadius: 4, width: `${(count / maxKtas) * 100}%` }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{count}명</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>병상 가용 현황</div>
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: 36, fontWeight: 700, color: '#16a34a' }}>{totalAvailable}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>/ {totalBeds} 병상 가용</div>
                  <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, margin: '8px 0' }}>
                    <div style={{ height: 6, background: '#16a34a', borderRadius: 3, width: `${(totalAvailable / totalBeds) * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════ 병원 현황 탭 ════ */}
        {activeTab === 'status' && (
          <div style={{ overflowY: 'auto', height: '100%', padding: 14 }}>
            {/* 통계 카드 2개 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div style={{ background: '#16a34a', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: '#bbf7d0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>전체 가용 병상</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
                  <span style={{ fontSize: 26, fontWeight: 700, color: '#fff' }}>{totalAvailable}</span>
                  <span style={{ fontSize: 14, color: '#bbf7d0' }}>/{totalBeds}개</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.25)', borderRadius: 2, marginTop: 6 }}>
                  <div style={{ height: 4, background: '#fff', borderRadius: 2, width: `${(totalAvailable / totalBeds) * 100}%` }} />
                </div>
                <div style={{ fontSize: 10, color: '#bbf7d0', marginTop: 2 }}>가용률 {Math.round((totalAvailable / totalBeds) * 100)}%</div>
              </div>
              <div style={{ background: '#fff', borderRadius: 10, border: `1px solid ${acceptedCount > 0 ? '#bbf7d0' : '#e2e8f0'}`, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>수락됨 · 이송 중</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: acceptedCount > 0 ? '#16a34a' : '#1e293b', marginTop: 2 }}>
                  {acceptedCount}<span style={{ fontSize: 14, color: '#94a3b8', fontWeight: 400 }}>명</span>
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>도착 대기 중인 환자</div>
              </div>
            </div>

            {/* 병상 서비스별 현황 + 운영 주의 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>병상 서비스별 현황</div>
                {BED_SERVICES.map(b => <BedBar key={b.name} {...b} />)}
              </div>
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>운영 현황 요약</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, marginBottom: 2 }}>가용 병상</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{totalAvailable}<span style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}> / {totalBeds}개</span></div>
                  </div>
                  <div style={{ background: '#fff7ed', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: '#ea580c', fontWeight: 600, marginBottom: 2 }}>대기 중 환자</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#ea580c' }}>{requests.length}<span style={{ fontSize: 12, color: '#64748b', fontWeight: 400 }}> 건</span></div>
                  </div>
                  {BED_SERVICES.some(b => b.available === 0) && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#dc2626', fontWeight: 600, marginBottom: 4 }}>
                        <AlertCircle size={13} /> 운영 주의
                      </div>
                      <p style={{ fontSize: 11, color: '#991b1b' }}>
                        {BED_SERVICES.filter(b => b.available === 0).map(b => b.name).join(' · ')} 병상 포화 상태. 신규 중증 환자 수용 제한 권고.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 환자 상세 뷰 (슬라이드인) */}
      <AnimatePresence>
        {selectedRequest && <PatientDetail req={selectedRequest} />}
      </AnimatePresence>

      {/* 거절 모달 */}
      <AnimatePresence>
        {rejectModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setRejectModal(null)}
          >
            <motion.div
              initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              style={{ background: '#fff', borderRadius: 16, padding: 20, width: 300, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>거절 사유 선택</h3>
                <button onClick={() => setRejectModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                  <XCircle size={20} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {REJECTION_REASONS.map(reason => (
                  <button
                    key={reason}
                    onClick={() => handleReject(rejectModal, reason)}
                    style={{ width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: '2px solid #f1f5f9', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => { const t = e.currentTarget; t.style.borderColor = '#fecaca'; t.style.background = '#fef2f2'; t.style.color = '#dc2626'; }}
                    onMouseLeave={e => { const t = e.currentTarget; t.style.borderColor = '#f1f5f9'; t.style.background = '#fff'; t.style.color = '#475569'; }}
                  >
                    {reason}
                    <ChevronDown size={16} style={{ transform: 'rotate(-90deg)', color: '#fca5a5' }} />
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
