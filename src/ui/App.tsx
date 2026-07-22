import { useEffect, useMemo, useState } from 'react';
import type { DialogueResult, Job, RunMode } from '../shared/types';

const statusLabels: Record<Job['status'], string> = {
  created: 'Đã tạo', extracting_document: 'Đang đọc Google Docs', correcting_text: 'Đang hiệu chỉnh',
  assigning_roles: 'Đang phân vai', awaiting_script_review: 'Chờ duyệt kịch bản',
  creating_vbee_project: 'Đang tạo project VBEE', pasting_vbee_blocks: 'Đang nhập block VBEE',
  awaiting_vbee_review: 'Chờ kiểm tra VBEE', generating_audio: 'Đang tạo TTS',
  downloading: 'Đang tải file', completed: 'Hoàn tất', failed: 'Lỗi', cancelled: 'Đã hủy'
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Có lỗi xảy ra.');
  return data;
}

export function App() {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<RunMode>(() => (localStorage.getItem('runMode') as RunMode) || 'review_twice');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState('');
  const selected = useMemo(() => jobs.find((job) => job.id === selectedId) ?? jobs[0], [jobs, selectedId]);

  const refresh = async () => {
    try {
      const incoming = await api<Job[]>('/api/jobs');
      setJobs((current) => incoming.map((next) => {
        const local = current.find((item) => item.id === next.id);
        return local?.status === 'awaiting_script_review' && next.status === 'awaiting_script_review'
          ? { ...next, dialogue: local.dialogue }
          : next;
      }));
    } catch (e) { setError(String(e)); }
  };
  useEffect(() => { void refresh(); const timer = setInterval(refresh, 1500); return () => clearInterval(timer); }, []);

  const start = async () => {
    setError(''); localStorage.setItem('runMode', mode);
    try {
      const job = await api<Job>('/api/jobs', { method: 'POST', body: JSON.stringify({ documentUrl: url, mode }) });
      setSelectedId(job.id); setUrl(''); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const action = async (name: 'approve-script' | 'approve-vbee' | 'cancel', body?: object) => {
    if (!selected) return;
    try {
      await api(`/api/jobs/${selected.id}/${name}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const updateDialogue = (dialogue: DialogueResult) => {
    setJobs((current) => current.map((job) => job.id === selected?.id ? { ...job, dialogue } : job));
  };

  return <main>
    <header><div><p className="eyebrow">NESSO · POE · HSE</p><h1>TTS Automation Control Center</h1></div><span className="online">LOCAL</span></header>

    <section className="start-card">
      <label>Google Docs URL</label>
      <div className="url-row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/document/d/..."/><button onClick={start} disabled={!url}>Bắt đầu xử lý</button></div>
      <div className="modes">
        <ModeCard active={mode === 'review_twice'} title="Kiểm tra 2 lần" description="Duyệt sau phân vai và sau khi nhập VBEE." onClick={() => setMode('review_twice')}/>
        <ModeCard active={mode === 'full_auto'} title="Full Auto" description="Tự chạy đến khi file RAR được di chuyển." onClick={() => setMode('full_auto')}/>
      </div>
    </section>

    {error && <div className="error">{error}</div>}

    <div className="workspace">
      <aside><h2>Jobs</h2>{jobs.length === 0 && <p className="muted">Chưa có job.</p>}{jobs.map((job) => <button className={`job ${selected?.id === job.id ? 'active' : ''}`} key={job.id} onClick={() => setSelectedId(job.id)}><strong>{job.documentTitle ?? 'Đang đọc tài liệu...'}</strong><span>{statusLabels[job.status]}</span></button>)}</aside>
      <section className="detail">{selected ? <JobDetail job={selected} onDialogue={updateDialogue} onApproveScript={() => action('approve-script', { dialogue: selected.dialogue })} onApproveVbee={() => action('approve-vbee')} onCancel={() => action('cancel')}/> : <Empty/>}</section>
    </div>
  </main>;
}

function ModeCard({ active, title, description, onClick }: { active: boolean; title: string; description: string; onClick(): void }) {
  return <button className={`mode ${active ? 'active' : ''}`} onClick={onClick}><span className="radio">{active ? '●' : '○'}</span><span><strong>{title}</strong><small>{description}</small></span></button>;
}

function JobDetail({ job, onDialogue, onApproveScript, onApproveVbee, onCancel }: { job: Job; onDialogue(d: DialogueResult): void; onApproveScript(): void; onApproveVbee(): void; onCancel(): void }) {
  const editable = job.status === 'awaiting_script_review';
  const changeTurn = (index: number, key: 'speaker' | 'text', value: string) => {
    if (!job.dialogue) return;
    const dialogue = { ...job.dialogue, dialogue: job.dialogue.dialogue.map((turn, i) => i === index ? { ...turn, [key]: value } : turn) } as DialogueResult;
    onDialogue(dialogue);
  };
  return <>
    <div className="detail-head"><div><p className="eyebrow">{job.mode === 'full_auto' ? 'FULL AUTO' : 'KIỂM TRA 2 LẦN'}</p><h2>{job.documentTitle ?? 'Đang khởi tạo...'}</h2>{job.correctionAttempts && (job.status === 'failed' || job.status === 'awaiting_script_review') && <small style={{ display: 'block', color: 'var(--color-muted, #888)', marginTop: '4px' }}>Số lần hiệu chỉnh: {job.correctionAttempts}/3</small>}</div><span className={`status ${job.status}`}>{statusLabels[job.status]}</span></div>
    <div className="progress"><Progress job={job}/></div>
    {job.validationIssues.length > 0 && <div className="issues">{job.validationIssues.map((issue, i) => <p key={i}>⚠ {issue.message}</p>)}</div>}
    {job.error && <div className="error">{job.error}</div>}
    {job.rolePromptVersion && <div className="prompt-meta" style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0 8px 0' }}>
      Prompt phân vai: V{job.rolePromptVersion} | Template SHA: {job.rolePromptTemplateSha256?.slice(0, 12)} | Parser: V4.4.2 Plain Text
    </div>}
    {job.dialogue && <div className="dialogue">
      <div className="roles"><span>A · {job.dialogue.roles.A}</span><span>B · {job.dialogue.roles.B}</span></div>
      {job.dialogue.dialogue.map((turn, index) => <article key={turn.order} className={`turn speaker-${turn.speaker.toLowerCase()}`}>
        <div className="turn-top"><span>#{String(turn.order).padStart(2, '0')}</span><select disabled={!editable} value={turn.speaker} onChange={(e) => changeTurn(index, 'speaker', e.target.value)}><option value="A">Người A</option><option value="B">Người B</option></select><small>{turn.text.length}/1000</small></div>
        <textarea ref={(el) => { if (el) el.scrollTop = 0; }} disabled={!editable} value={turn.text} onChange={(e) => changeTurn(index, 'text', e.target.value)}/>
      </article>)}
    </div>}
    <div className="actions">
      {job.status === 'awaiting_script_review' && <button className="primary" onClick={onApproveScript}>Duyệt và nhập VBEE</button>}
      {job.status === 'awaiting_vbee_review' && <><a className="button secondary" href={job.vbeeProjectUrl} target="_blank">Mở project VBEE</a><button className="primary" onClick={onApproveVbee}>Xác nhận và tạo TTS</button></>}
      {!['completed','failed','cancelled'].includes(job.status) && <button className="danger" onClick={onCancel}>Hủy workflow</button>}
    </div>
    {job.downloadedFile && <div className="success">Đã lưu: <code>{job.downloadedFile}</code></div>}
    {job.logs && job.logs.length > 0 && <div className="job-logs"><h3>Log</h3><div className="log-scroll" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>{job.logs.map((line, i) => <div key={i} className="log-line">{line}</div>)}</div></div>}
  </>;
}

function Progress({ job }: { job: Job }) {
  const steps = ['Google Docs', 'Hiệu chỉnh', 'Phân vai', 'Duyệt 1', 'Nhập VBEE', 'Duyệt 2', 'TTS & RAR'];
  const map: Record<Job['status'], number> = { created:0, extracting_document:0, correcting_text:1, assigning_roles:2, awaiting_script_review:3, creating_vbee_project:4, pasting_vbee_blocks:4, awaiting_vbee_review:5, generating_audio:6, downloading:6, completed:7, failed:0, cancelled:0 };
  return <>{steps.map((step, i) => <div key={step} className={i < map[job.status] ? 'done' : i === map[job.status] ? 'current' : ''}><i>{i < map[job.status] ? '✓' : i + 1}</i><span>{step}</span></div>)}</>;
}

function Empty() { return <div className="empty"><span>◌</span><h2>Sẵn sàng xử lý</h2><p>Dán URL Google Docs và chọn chế độ để bắt đầu.</p></div>; }
