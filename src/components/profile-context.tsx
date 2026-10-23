'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import { useFocusTrap } from './use-focus-trap';
import { libraryApi, LIBRARY_KEY, PROFILE_KEY, TONIGHT_KEY } from '@/lib/library-client';
import { PROFILES, profileName, type ProfileId } from '@/lib/library-types';

const ProfileContext = createContext<{ profile: ProfileId | null; ready: boolean; openPicker: () => void }>({ profile: null, ready: false, openPicker: () => {} });
export const useProfile = () => useContext(ProfileContext);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { verified } = useAuth();
  const queryClient = useQueryClient();
  const [requested, setRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const query = useQuery({ queryKey: PROFILE_KEY, queryFn: ({ signal }) => libraryApi.profile(signal), enabled: verified, retry: 1, staleTime: 0, refetchOnWindowFocus: true });
  const profile = verified ? query.data?.profile || null : null;
  useEffect(() => {
    if (!verified) return;
    const refresh = () => {
      if (document.hidden) return;
      for (const queryKey of [PROFILE_KEY, LIBRARY_KEY, TONIGHT_KEY]) void queryClient.invalidateQueries({ queryKey });
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [verified, queryClient]);
  const open = verified && (requested || (query.isSuccess && !profile));
  useFocusTrap(open, dialogRef);
  const select = async (id: ProfileId) => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const data = await libraryApi.selectProfile(id);
      queryClient.setQueryData(PROFILE_KEY, data);
      await Promise.all([queryClient.invalidateQueries({ queryKey: LIBRARY_KEY }), queryClient.invalidateQueries({ queryKey: TONIGHT_KEY })]);
      setRequested(false);
    } catch (err) { setError(err instanceof Error ? err.message : '切换失败，请重试'); }
    finally { setSaving(false); }
  };
  return <ProfileContext.Provider value={{ profile, ready: query.isSuccess, openPicker: () => { setError(''); setRequested(true); } }}>
    {children}
    {open && <div className="profile-overlay" onKeyDown={(e) => { if (e.key === 'Escape' && profile && !saving) setRequested(false); }}>
      <div className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-heading" ref={dialogRef} tabIndex={-1}>
        <p className="profile-wordmark">WAJJTV</p><h2 id="profile-heading">今晚，是谁来选片？</h2><p className="text-muted text-sm mt-3">你们的片单放在一起，喜欢什么，各自记录。</p>
        <div className="profile-choices">{PROFILES.map((p) => <button key={p.id} disabled={saving} onClick={() => void select(p.id)} aria-label={`选择${p.name}`} className={profile === p.id ? 'active' : ''}><span className={`profile-avatar ${p.id}`}>{p.name[0]}</span><strong>{p.name}</strong><span>{profile === p.id ? '当前档案' : '进入我的片单'}</span></button>)}</div>
        {error && <p className="text-danger text-sm" role="alert">{error}</p>}
        {saving && <p className="text-accent text-sm" role="status">正在切换档案…</p>}
        {profile && <button className="btn-ghost mt-5" disabled={saving} onClick={() => setRequested(false)}>返回</button>}
        <p className="text-faint text-xs mt-5">共享登录，海清和静静可以互相查看片单。</p>
      </div>
    </div>}
  </ProfileContext.Provider>;
}
export function ProfileButton() {
  const { verified, openLogin } = useAuth();
  const { profile, openPicker } = useProfile();
  return <button className="profile-button" onClick={verified ? openPicker : openLogin} aria-label={profile ? `当前档案：${profileName(profile)}，切换档案` : '选择档案'}><span className={`profile-dot ${profile || ''}`}>{profile ? profileName(profile)[0] : '人'}</span><span>{profile ? profileName(profile) : '档案'}</span><span aria-hidden>⌄</span></button>;
}
