import React, { useState, useEffect } from 'react';
import { 
  Ambulance, 
  ChevronRight,
  Stethoscope,
  Lock,
  User as UserIcon,
  X,
  Loader2
} from 'lucide-react';
import { ParamedicDashboard } from './components/ParamedicDashboard';
import { HospitalDashboard } from './components/HospitalDashboard';
import { UserRole } from './types';
import { 
  LAYOUT_CONTAINER, 
  ModernCard, 
  ModernButton,
  ModernInput,
  cn
} from './components/ui/DesignSystem';
import { AnimatePresence, motion } from 'motion/react';
import { supabase } from './utils/supabase/client';

interface UserSession {
  role: UserRole;
  name: string;
  id: string;
}

const demoAuthEnabled =
  typeof import.meta !== 'undefined' &&
  Boolean((import.meta as any).env?.VITE_DEMO_AUTH);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    }),
  ]);
}

function getReadableAuthError(error: unknown): string {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return 'Supabase auth server could not be reached. Check internet access, firewall or VPN, ad blocker, and whether the Supabase project is active.';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown authentication error';
}

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<UserSession | null>(null);
  
  // Login Modal State
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [selectedRoleForLogin, setSelectedRoleForLogin] = useState<UserRole>(null);
  const [loginId, setLoginId] = useState(''); // This will be email
  const [loginPwd, setLoginPwd] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false); // Toggle for Sign Up

  // 1. Check for existing Supabase session on mount
  useEffect(() => {
    if (demoAuthEnabled) {
      const saved = localStorage.getItem('ems_demo_session');
      if (saved) {
        try {
          setUser(JSON.parse(saved));
        } catch (error) {
          console.warn('Failed to parse demo session:', error);
          localStorage.removeItem('ems_demo_session');
        }
      }
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const checkSession = async () => {
      try {
        const { data: { session } } = await withTimeout(
          supabase.auth.getSession(),
          4000,
          'Supabase session',
        );

        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('role, name')
            .eq('id', session.user.id)
            .single();

          if (profile && isMounted) {
            setUser({
              id: session.user.id,
              role: profile.role as UserRole,
              name: profile.name || session.user.email?.split('@')[0] || 'User'
            });
          }
        }
      } catch (error) {
        console.warn('Initial session check failed:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        setUser(null);
      }
      // Note: We handle the 'SIGNED_IN' logic primarily in the submit handler to ensure profile fetching
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleLoginStart = (role: UserRole) => {
    setSelectedRoleForLogin(role);
    setLoginId('');
    setLoginPwd('');
    setIsSignUp(false);
    setShowLoginModal(true);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId || !loginPwd) return;

    setIsLoggingIn(true);
    
    try {
      if (demoAuthEnabled) {
        const demoUser: UserSession = {
          id: `demo-${selectedRoleForLogin}-${Date.now()}`,
          role: selectedRoleForLogin,
          name: loginId.split('@')[0] || 'demo-user',
        };
        localStorage.setItem('ems_demo_session', JSON.stringify(demoUser));
        setUser(demoUser);
        setShowLoginModal(false);
        return;
      }

      if (isSignUp) {
        // 1. Sign Up
        const { data: authData, error: authError } = await withTimeout(
          supabase.auth.signUp({
            email: loginId,
            password: loginPwd,
          }),
          8000,
          'Sign up',
        );

        if (authError) throw authError;

        if (authData.user) {
          // 2. Create Profile
          const { error: profileError } = await supabase
            .from('profiles')
            .insert({
              id: authData.user.id,
              role: selectedRoleForLogin,
              name: loginId.split('@')[0], // Default name from email
              organization: selectedRoleForLogin === 'paramedic' ? '119구조대' : '서울대학교병원'
            });

          if (profileError) {
             console.error("Profile creation failed:", profileError);
             // Proceed anyway, might cause issues but better than blocking
          }

          alert("회원가입이 완료되었습니다. 자동 로그인됩니다.");
          
          // Set local state
          setUser({
            id: authData.user.id,
            role: selectedRoleForLogin,
            name: loginId.split('@')[0]
          });
          setShowLoginModal(false);
        }
      } else {
        // Login
        const { data, error } = await withTimeout(
          supabase.auth.signInWithPassword({
            email: loginId,
            password: loginPwd,
          }),
          8000,
          'Sign in',
        );

        if (error) throw error;

        if (data.user) {
           // Fetch profile
           const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role, name')
            .eq('id', data.user.id)
            .single();
            
           if (profileError || !profile) {
             // Fallback if profile missing (maybe created manually in dashboard)
             console.warn("Profile missing, using selected role temporarily");
             setUser({
                id: data.user.id,
                role: selectedRoleForLogin, // Use the one selected in UI as fallback
                name: data.user.email?.split('@')[0] || 'User'
             });
             
             // Try to create profile if missing?
             await supabase.from('profiles').insert({
                 id: data.user.id,
                 role: selectedRoleForLogin,
                 name: data.user.email?.split('@')[0]
             });
           } else {
             setUser({
               id: data.user.id,
               role: profile.role as UserRole,
               name: profile.name || 'User'
             });
           }
           setShowLoginModal(false);
        }
      }
    } catch (error: any) {
      console.error("Auth error:", error);
      alert(`로그인/회원가입 실패: ${getReadableAuthError(error)}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    if (demoAuthEnabled) {
      localStorage.removeItem('ems_demo_session');
      setUser(null);
      return;
    }

    await supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem('ems_app_session'); // Clean up old legacy session if any
  };

  // Loading Screen
  if (isLoading) {
    return (
      <div className={cn(LAYOUT_CONTAINER, "items-center justify-center")}>
        <Loader2 className="animate-spin text-[#00796B]" size={48} />
      </div>
    );
  }

  // Authenticated Views
  if (user) {
    if (user.role === 'paramedic') {
      return <ParamedicDashboard userName={user.name} onLogout={handleLogout} />;
    }
    if (user.role === 'hospital') {
      return <HospitalDashboard onLogout={handleLogout} />;
    }
  }

  // Unauthenticated (Role Selection) View
  return (
    <div className={LAYOUT_CONTAINER}>
      <div className="flex-1 flex flex-col p-8 justify-center relative">
        {/* Header Section */}
        <div className="flex flex-col items-center text-center mb-12">
          <div className="p-4 bg-red-50 rounded-full mb-6 ring-8 ring-red-50/50">
            <Ambulance size={56} className="text-[#C0392B]" />
          </div>
          <h1 className="text-3xl font-black text-gray-900 leading-tight mb-2 tracking-tight">
            응급 환자 이송<br/>통합 시스템
          </h1>
          <p className="text-gray-500 font-bold text-sm tracking-wide">
            Emergency Patient Transfer System
          </p>
        </div>

        {/* Role Selection */}
        <div className="flex flex-col gap-5 w-full">
          <button 
            onClick={() => handleLoginStart('paramedic')}
            className="group relative"
          >
            <ModernCard className="flex items-center p-6 border-2 hover:border-[#C0392B] hover:shadow-lg transition-all group-active:scale-[0.98] text-left">
              <div className="p-4 bg-red-50 rounded-2xl mr-5 group-hover:bg-[#C0392B] transition-colors">
                <Ambulance size={32} className="text-[#C0392B] group-hover:text-white transition-colors" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-black text-gray-900 mb-1">구급대원</h3>
                <p className="text-sm font-medium text-gray-500">환자 정보 입력 및 이송 요청</p>
              </div>
              <ChevronRight className="text-gray-300 group-hover:text-[#C0392B] transition-colors" />
            </ModernCard>
          </button>

          <button 
            onClick={() => handleLoginStart('hospital')}
            className="group relative"
          >
            <ModernCard className="flex items-center p-6 border-2 hover:border-[#00796B] hover:shadow-lg transition-all group-active:scale-[0.98] text-left">
              <div className="p-4 bg-teal-50 rounded-2xl mr-5 group-hover:bg-[#00796B] transition-colors">
                <Stethoscope size={32} className="text-[#00796B] group-hover:text-white transition-colors" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-black text-gray-900 mb-1">병원 응급실</h3>
                <p className="text-sm font-medium text-gray-500">이송 요청 수신 및 병상 관리</p>
              </div>
              <ChevronRight className="text-gray-300 group-hover:text-[#00796B] transition-colors" />
            </ModernCard>
          </button>
        </div>

        {/* Login Modal Overlay */}
        <AnimatePresence>
          {showLoginModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-8"
            >
              <div className="w-full max-w-sm">
                <div className="flex justify-between items-center mb-8">
                  <button 
                    onClick={() => setShowLoginModal(false)}
                    className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-500"
                  >
                    <X size={24} />
                  </button>
                  <h2 className="text-xl font-black text-gray-900">
                    {selectedRoleForLogin === 'paramedic' ? '구급대원 로그인' : '병원 관계자 로그인'}
                  </h2>
                  <div className="w-8" /> {/* Spacer */}
                </div>

                <form onSubmit={handleAuthSubmit} className="flex flex-col gap-5">
                   <div>
                     <label className="block text-sm font-bold text-gray-500 mb-2 uppercase">이메일</label>
                     <div className="relative">
                       <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                       <ModernInput 
                          placeholder="name@example.com" 
                          type="email"
                          className="pl-12" 
                          value={loginId}
                          onChange={(e) => setLoginId(e.target.value)}
                          autoFocus
                       />
                     </div>
                   </div>

                   <div>
                     <label className="block text-sm font-bold text-gray-500 mb-2 uppercase">비밀번호</label>
                     <div className="relative">
                       <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                       <ModernInput 
                          type="password" 
                          placeholder="비밀번호를 입력하세요" 
                          className="pl-12"
                          value={loginPwd}
                          onChange={(e) => setLoginPwd(e.target.value)}
                       />
                     </div>
                   </div>

                   <ModernButton 
                      type="submit"
                      disabled={!loginId || !loginPwd || isLoggingIn}
                      className={cn(
                        "mt-4 py-4 text-lg shadow-lg",
                        selectedRoleForLogin === 'paramedic' 
                          ? "bg-[#C0392B] hover:bg-[#A93226] shadow-red-200" 
                          : "bg-[#00796B] hover:bg-[#00695C] shadow-teal-200"
                      )}
                   >
                      {isLoggingIn ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        isSignUp ? "회원가입" : "로그인"
                      )}
                   </ModernButton>

                   <div className="text-center">
                     <button 
                        type="button"
                        onClick={() => setIsSignUp(!isSignUp)}
                        className="text-sm font-bold text-gray-500 hover:text-gray-900 underline"
                     >
                       {isSignUp ? "이미 계정이 있으신가요? 로그인" : "계정이 없으신가요? 회원가입"}
                     </button>
                   </div>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
