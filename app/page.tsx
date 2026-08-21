'use client';
import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [estado, setEstado] = useState('Listo para iniciar la sesión de evaluación');
  const [grabando, setGrabando] = useState(false);
  const [informe, setInforme] = useState<any>(null);
  
  const [idioma, setIdioma] = useState('es-ES');
  const [contextoEntorno, setContextoEntorno] = useState('Comité de dirección o entorno corporativo');
  const [audienciaObjetivo, setAudienciaObjetivo] = useState('C-Level o stakeholders clave');
  const [objetivoDiscurso, setObjetivoDiscurso] = useState('Persuadir e informar con impacto');
  const [mostrarConfiguracion, setMostrarConfiguracion] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const resultadosRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (informe && resultadosRef.current) {
      resultadosRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [informe]);

  const extraerAudioWav = async (videoBlob: Blob): Promise<Blob> => {
    const arrayBuffer = await videoBlob.arrayBuffer();
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    const numOfChan = 1; 
    const sampleRate = 16000;
    const length = audioBuffer.length * 2 + 44;
    const out = new ArrayBuffer(length);
    const view = new DataView(out);
    let pos = 0;

    const writeString = (str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(pos++, str.charCodeAt(i)); };
    const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
    const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };

    writeString('RIFF'); setUint32(length - 8); writeString('WAVE'); writeString('fmt ');
    setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(sampleRate);
    setUint32(sampleRate * 2); setUint16(2); setUint16(16); writeString('data');
    setUint32(length - pos - 4);

    const channelData = audioBuffer.getChannelData(0);
    let offset = 0;
    while (offset < audioBuffer.length) {
      let sample = Math.max(-1, Math.min(1, channelData[offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true); pos += 2; offset++;
    }
    return new Blob([out], { type: 'audio/wav' });
  };

  const procesarYEnviarMultimedia = async (videoBlob: Blob) => {
    setInforme(null);
    setEstado('⚡ Destripando vídeo en local (Audio ligero y fotos clave)...');

    try {
      const wavBlob = await extraerAudioWav(videoBlob);
      const nombreAudio = `audio_entente_${Date.now()}.wav`;

      const frames: string[] = await new Promise((resolve) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const extracted: string[] = [];

        video.src = URL.createObjectURL(videoBlob);
        video.muted = true;

        video.onloadedmetadata = async () => {
          const duration = video.duration;
          const interval = duration / 24;
          canvas.width = 640;
          canvas.height = 360;

          for (let i = 0; i < 24; i++) {
            video.currentTime = i * interval;
            await new Promise((r) => { 
              video.onseeked = () => setTimeout(r, 50); 
            });
            if (ctx) {
              ctx.drawImage(video, 0, 0, 640, 360);
              extracted.push(canvas.toDataURL('image/jpeg', 0.5).split(',')[1]); 
            }
          }
          URL.revokeObjectURL(video.src);
          resolve(extracted);
        };
      });

      setEstado('☁️ Subiendo pista de audio por tu ruta original de API...');
      
      const formData = new FormData();
      formData.append('file', wavBlob, nombreAudio);
      formData.append('fileName', nombreAudio);

      const resUpload = await fetch('/api/upload', { 
        method: 'POST', 
        body: formData 
      });

      if (!resUpload.ok) {
        const errJson = await resUpload.json().catch(() => ({}));
        throw new Error(errJson.error || 'Error al subir el audio a /api/upload');
      }

      setEstado('🤖 Evaluando oratoria (Whisper + GPT-4o)... Análisis clínico en curso.');
      
      const resAnalyze = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileName: nombreAudio, 
          language: idioma, 
          frames,
          contexto: contextoEntorno,
          audiencia: audienciaObjetivo,
          objetivo: objetivoDiscurso
        }),
      });

      if (!resAnalyze.ok) {
        const errJson = await resAnalyze.json().catch(() => ({}));
        throw new Error(errJson.error || 'Error en análisis IA');
      }

      const json = await resAnalyze.json();
      setInforme(json.data);
      setEstado('✅ ¡Análisis completado! (Ficheros eliminados por privacidad)');
    } catch (e: any) {
      setEstado(`❌ ${e.message}`);
    }
  };

  const iniciarGrabacion = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720, facingMode: "user" }, 
        audio: true 
      });

      streamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.play();
      }

      mediaRecorderRef.current = new MediaRecorder(stream, { 
        mimeType: 'video/webm; codecs=vp8,opus',
        videoBitsPerSecond: 800000 
      });
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
        const blobVideo = new Blob(chunksRef.current, { type: 'video/webm' });
        await procesarYEnviarMultimedia(blobVideo);
      };

      mediaRecorderRef.current.start();
      setGrabando(true);
      setEstado('🔴 Grabando sesión ejecutiva...');
    } catch (err: any) {
      setEstado(`❌ Error de permisos: ${err.message}`);
    }
  };

  const detenerGrabacion = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setGrabando(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await procesarYEnviarMultimedia(file);
  };

  const exportarPDF = () => window.print();

  const generateSmoothPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? i : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return path;
  };

  const getConfianzaColor = (confianza: string) => {
    if (!confianza) return '#64748B';
    const c = confianza.toLowerCase();
    if (c.includes('alta')) return '#10B981';
    if (c.includes('media')) return '#F59E0B';
    if (c.includes('baja')) return '#EF4444';
    return '#64748B';
  };

  const AuditoriaBlock = ({ titulo, observacion, interpretacion, confianza }: { titulo: string, observacion: string, interpretacion: string, confianza: string }) => (
    <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0', marginBottom: '12px' }}>
      <h5 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#1E293B' }}>{titulo}</h5>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
        <div><strong style={{ color: '#475569' }}>Observación:</strong> <span style={{ color: '#334155' }}>{observacion}</span></div>
        <div><strong style={{ color: '#475569' }}>Interpretación:</strong> <span style={{ color: '#334155' }}>{interpretacion}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <strong style={{ color: '#475569' }}>Confianza del sistema:</strong> 
          <span style={{ 
            background: `${getConfianzaColor(confianza)}20`, 
            color: getConfianzaColor(confianza), 
            padding: '2px 8px', 
            borderRadius: '12px', 
            fontSize: '11px', 
            fontWeight: '600',
            textTransform: 'uppercase'
          }}>
            {confianza}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '24px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: '#F8FAFC', color: '#0F172A', overflowY: 'auto' }}>
      
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background-color: #FFFFFF !important; }
        }
      `}</style>

      <div style={{ maxWidth: '720px', width: '100%', textAlign: 'center', margin: '10px 0 60px 0' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', letterSpacing: '-0.5px', marginBottom: '4px', color: '#1E293B' }}>Entente</h1>
        <p style={{ color: '#64748B', fontSize: '11px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '600' }}>Plataforma de Oratoria Ejecutiva & Inteligencia Corporal</p>

        <div className="no-print" style={{ fontSize: '11px', color: '#64748B', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px' }}>🔒</span> <span>Procesamiento clínico y efímero. Los datos se eliminan tras el análisis.</span>
        </div>

        {!grabando && !informe && (
          <div className="no-print" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px', marginBottom: '24px', textAlign: 'left', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div 
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setMostrarConfiguracion(!mostrarConfiguracion)}
            >
              <h3 style={{ margin: 0, fontSize: '15px', color: '#1E293B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🎯</span> Contexto de la Intervención
              </h3>
              <span style={{ color: '#64748B', fontSize: '12px' }}>{mostrarConfiguracion ? 'Ocultar ▲' : 'Modificar ▼'}</span>
            </div>
            
            {mostrarConfiguracion && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>Entorno / Formato:</label>
                  <select value={contextoEntorno} onChange={(e) => setContextoEntorno(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#F8FAFC' }}>
                    <option value="Comité de dirección o entorno corporativo">Comité de dirección / Junta</option>
                    <option value="Pitch de ventas B2B">Pitch Comercial / Ventas B2B</option>
                    <option value="Daily meeting o reunión de equipo corta">Daily / Reunión de equipo</option>
                    <option value="Presentación magistral tipo TED">Charla Magistral / Tipo TED</option>
                    <option value="Comunicación de crisis a empleados">Comunicación de crisis / Interna</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>Audiencia principal:</label>
                  <input type="text" value={audienciaObjetivo} onChange={(e) => setAudienciaObjetivo(e.target.value)} placeholder="Ej: CEO, Inversores, Equipo técnico..." style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#F8FAFC', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>Objetivo:</label>
                    <input type="text" value={objetivoDiscurso} onChange={(e) => setObjetivoDiscurso(e.target.value)} placeholder="Ej: Aprobar presupuesto" style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#F8FAFC', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ width: '140px' }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#475569', marginBottom: '4px' }}>Idioma:</label>
                    <select value={idioma} onChange={(e) => setIdioma(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#F8FAFC' }}>
                      <option value="es-ES">🇪🇸 ES</option>
                      <option value="es-MX">🇲🇽 LATAM</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="no-print" style={{ width: '100%', height: '240px', backgroundColor: '#000', borderRadius: '12px', overflow: 'hidden', marginBottom: '16px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}>
          <video ref={videoPreviewRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        </div>

        <div className="no-print" style={{ padding: '12px 16px', border: '1px solid #E2E8F0', borderRadius: '8px', marginBottom: '16px', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <p style={{ fontSize: '14px', margin: 0, fontWeight: '500', color: '#334155' }}>{estado}</p>
        </div>

        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '30px' }}>
          <button 
            onClick={grabando ? detenerGrabacion : iniciarGrabacion}
            style={{ background: grabando ? '#EF4444' : '#2563EB', color: 'white', border: 'none', padding: '14px 24px', fontSize: '16px', fontWeight: '600', borderRadius: '8px', cursor: 'pointer', width: '100%', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)', transition: 'all 0.2s' }}
          >
            {grabando ? '⏹ Finalizar y Evaluar Sesión' : '📹 Iniciar Grabación Ejecutiva'}
          </button>

          {!grabando && (
            <div>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="video/mp4,video/webm,video/quicktime" style={{ display: 'none' }} />
              <button 
                onClick={() => fileInputRef.current?.click()}
                style={{ background: '#FFFFFF', color: '#334155', border: '1px solid #CBD5E1', padding: '12px 24px', fontSize: '14px', fontWeight: '600', borderRadius: '8px', cursor: 'pointer', width: '100%', transition: 'all 0.2s' }}
              >
                📂 Subir vídeo pregrabado (Local)
              </button>
            </div>
          )}
        </div>

        {informe && (
          <div ref={resultadosRef} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '-10px' }}>
              <button onClick={exportarPDF} style={{ background: '#0F172A', color: 'white', border: 'none', padding: '8px 16px', fontSize: '13px', fontWeight: '600', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                📥 Descargar Informe Clínico (PDF)
              </button>
            </div>

            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '700', color: '#1E293B', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '2px solid #F1F5F9', paddingBottom: '10px' }}>
                📊 Datos Telemétricos Extraídos
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: '#64748B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Velocidad Media</div>
                  <div style={{ fontSize: '28px', fontWeight: '800', color: '#2563EB', marginTop: '4px' }}>{informe.datosDuros?.ritmoPalabrasPorMinuto || 0} <span style={{ fontSize: '14px', fontWeight: '600', color: '#64748B' }}>WPM</span></div>
                </div>
                <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '12px', color: '#64748B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Disfluencias Reales</div>
                  <div style={{ fontSize: '28px', fontWeight: '800', color: (informe.datosDuros?.muletillasDetectadas || 0) > 3 ? '#F59E0B' : '#10B981', marginTop: '4px' }}>{informe.datosDuros?.muletillasDetectadas || 0}</div>
                  {informe.datosDuros?.muletillasLista && informe.datosDuros.muletillasLista.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                      {informe.datosDuros.muletillasLista.map((m: string, i: number) => <span key={i} style={{ background: '#FEF3C7', color: '#B45309', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>"{m}"</span>)}
                    </div>
                  )}
                </div>
              </div>
              
              {informe.datosDuros?.ritmoGrafica && informe.datosDuros.ritmoGrafica.length > 0 && (
                <div style={{ position: 'relative', width: '100%', height: '120px', marginTop: '20px' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '8px', fontWeight: '600' }}>Variación del ritmo a lo largo del tiempo (WPM)</div>
                  <svg viewBox="0 0 500 120" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                    <rect x="0" y="20" width="500" height="80" fill="#F8FAFC" rx="4" />
                    {(() => {
                      const data = informe.datosDuros.ritmoGrafica;
                      const points = data.map((d: any, idx: number) => ({
                        x: (idx / (data.length - 1 || 1)) * 480 + 10,
                        y: 100 - ((Math.min(240, Math.max(60, d.wpm)) - 60) / 180) * 80
                      }));
                      return <path d={generateSmoothPath(points)} fill="none" stroke="#2563EB" strokeWidth="3" strokeLinecap="round" />;
                    })()}
                  </svg>
                </div>
              )}
            </div>

            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '700', color: '#1E293B', borderBottom: '2px solid #F1F5F9', paddingBottom: '10px' }}>
                🎯 Índice de Persuasión Estructural
              </h4>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '20px' }}>
                <div style={{ background: '#F8FAFC', padding: '20px', borderRadius: '50%', border: '4px solid #8B5CF6', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', flexShrink: 0 }}>
                  <span style={{ fontSize: '28px', fontWeight: '800', color: '#1E293B', lineHeight: '1' }}>{informe.rubricaPersuasion?.total || 0}</span>
                  <span style={{ fontSize: '12px', color: '#64748B', fontWeight: '600' }}>/ 10</span>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', color: '#334155' }}>{informe.rubricaPersuasion?.justificacionGlobal}</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <div style={{ padding: '10px', background: '#F8FAFC', borderRadius: '6px', borderLeft: '3px solid #8B5CF6', fontSize: '13px' }}>
                  <span style={{ display: 'block', color: '#64748B', marginBottom: '4px' }}>Claridad Tesis</span>
                  <strong style={{ color: '#1E293B' }}>{informe.rubricaPersuasion?.claridadTesis || 0} / 2</strong>
                </div>
                <div style={{ padding: '10px', background: '#F8FAFC', borderRadius: '6px', borderLeft: '3px solid #8B5CF6', fontSize: '13px' }}>
                  <span style={{ display: 'block', color: '#64748B', marginBottom: '4px' }}>Adecuación Contexto</span>
                  <strong style={{ color: '#1E293B' }}>{informe.rubricaPersuasion?.adecuacionContexto || 0} / 2</strong>
                </div>
                <div style={{ padding: '10px', background: '#F8FAFC', borderRadius: '6px', borderLeft: '3px solid #8B5CF6', fontSize: '13px' }}>
                  <span style={{ display: 'block', color: '#64748B', marginBottom: '4px' }}>Retórica</span>
                  <strong style={{ color: '#1E293B' }}>{informe.rubricaPersuasion?.construccionRetorica || 0} / 2</strong>
                </div>
                <div style={{ padding: '10px', background: '#F8FAFC', borderRadius: '6px', borderLeft: '3px solid #8B5CF6', fontSize: '13px' }}>
                  <span style={{ display: 'block', color: '#64748B', marginBottom: '4px' }}>Cierre</span>
                  <strong style={{ color: '#1E293B' }}>{informe.rubricaPersuasion?.cierreMovilizacion || 0} / 2</strong>
                </div>
              </div>
            </div>

            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '700', color: '#1E293B', borderBottom: '2px solid #F1F5F9', paddingBottom: '10px' }}>
                🚀 Top 3 Palancas de Crecimiento
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {informe.top3PalancasCrecimiento && informe.top3PalancasCrecimiento.map((palanca: any, idx: number) => (
                  <div key={idx} style={{ padding: '16px', background: '#F8FAFC', borderRadius: '8px', borderLeft: `4px solid ${palanca.impacto.toLowerCase() === 'alto' ? '#EF4444' : palanca.impacto.toLowerCase() === 'medio' ? '#F59E0B' : '#3B82F6'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <h5 style={{ margin: 0, fontSize: '15px', color: '#1E293B' }}>{idx + 1}. {palanca.comportamiento}</h5>
                      <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: '700', color: '#64748B', background: '#E2E8F0', padding: '2px 6px', borderRadius: '4px' }}>Impacto {palanca.impacto}</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#475569', marginBottom: '8px' }}>
                      <strong>Evidencia:</strong> {palanca.evidenciaObservada}
                    </div>
                    <div style={{ fontSize: '13px', color: '#047857', background: '#ECFDF5', padding: '8px 12px', borderRadius: '6px' }}>
                      <strong>Recomendación:</strong> {palanca.recomendacion}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '700', color: '#1E293B', borderBottom: '2px solid #F1F5F9', paddingBottom: '10px' }}>
                  🗣️ Auditoría Retórica
                </h4>
                {informe.auditoriaRetorica && (
                  <>
                    <AuditoriaBlock 
                      titulo="Apertura"
                      observacion={informe.auditoriaRetorica.apertura.evidencia}
                      interpretacion={informe.auditoriaRetorica.apertura.evaluacionCritica}
                      confianza="Alta"
                    />
                    <AuditoriaBlock 
                      titulo="Argumentación Central"
                      observacion={informe.auditoriaRetorica.argumentacion.evidencia}
                      interpretacion={informe.auditoriaRetorica.argumentacion.evaluacionCritica}
                      confianza="Media"
                    />
                    <AuditoriaBlock 
                      titulo="Cierre Estratégico"
                      observacion={informe.auditoriaRetorica.cierre.evidencia}
                      interpretacion={informe.auditoriaRetorica.cierre.evaluacionCritica}
                      confianza="Alta"
                    />
                  </>
                )}
              </div>

              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '700', color: '#1E293B', borderBottom: '2px solid #F1F5F9', paddingBottom: '10px' }}>
                  👁️ Auditoría Visual Sostenida
                </h4>
                {informe.auditoriaVisual && (
                  <>
                    <AuditoriaBlock 
                      titulo="Eje de Mirada"
                      observacion={informe.auditoriaVisual.ejeMirada.observacion}
                      interpretacion={informe.auditoriaVisual.ejeMirada.interpretacion}
                      confianza={informe.auditoriaVisual.ejeMirada.confianza}
                    />
                    <AuditoriaBlock 
                      titulo="Postura y Gestualidad"
                      observacion={informe.auditoriaVisual.posturaGestualidad.observacion}
                      interpretacion={informe.auditoriaVisual.posturaGestualidad.interpretacion}
                      confianza={informe.auditoriaVisual.posturaGestualidad.confianza}
                    />
                  </>
                )}
              </div>
            </div>

            {informe.eventosDestacados && informe.eventosDestacados.length > 0 && (
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '700', color: '#1E293B', borderBottom: '2px solid #F1F5F9', paddingBottom: '10px' }}>
                  ⏱ Timeline de Momentos Clave
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {informe.eventosDestacados.map((item: any, idx: number) => (
                    <div key={idx} style={{ padding: '12px', background: '#F8FAFC', borderRadius: '8px', borderLeft: '4px solid #3B82F6', display: 'flex', gap: '16px' }}>
                      <div style={{ fontWeight: '700', color: '#2563EB', fontSize: '13px', minWidth: '40px' }}>{item.tiempoAproximado}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontSize: '13px', color: '#475569', fontStyle: 'italic' }}>"{item.evidenciaLiteral}"</div>
                        <div style={{ fontSize: '13px', color: '#1E293B' }}>{item.diagnostico}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}