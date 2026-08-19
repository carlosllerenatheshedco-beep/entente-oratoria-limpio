'use client';
import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [estado, setEstado] = useState('Listo para iniciar la sesión de evaluación');
  const [grabando, setGrabando] = useState(false);
  const [informe, setInforme] = useState<any>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const resultadosRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (informe && resultadosRef.current) {
      resultadosRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [informe]);

  const iniciarGrabacion = async () => {
    setInforme(null);
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

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'video/webm' });
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        setEstado('⏳ Subiendo vídeo a la nube...');
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }

        const blobVideo = new Blob(chunksRef.current, { type: 'video/webm' });
        const nombreArchivo = `video_entente_${Date.now()}.webm`;
        const formData = new FormData();
        formData.append('file', blobVideo);
        formData.append('fileName', nombreArchivo);

        try {
          const resUpload = await fetch('/api/upload', { method: 'POST', body: formData });
          if (!resUpload.ok) throw new Error('Error al subir vídeo');

          setEstado('🤖 Generando informe ejecutivo avanzado (Whisper + GPT-4o)...');
          const resAnalyze = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: nombreArchivo }),
          });

          if (!resAnalyze.ok) throw new Error('Error en análisis IA');

          const json = await resAnalyze.json();
          setInforme(json.data);
          setEstado('✅ ¡Análisis completado con éxito!');
        } catch (e: any) {
          setEstado(`❌ Error: ${e.message}`);
        }
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

  return (
    <main style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'flex-start',
      padding: '24px', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      backgroundColor: '#F8FAFC',
      color: '#0F172A',
      overflowY: 'auto'
    }}>
      <div style={{ maxWidth: '680px', width: '100%', textAlign: 'center', margin: '10px 0 60px 0' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', letterSpacing: '-0.5px', marginBottom: '4px', color: '#1E293B' }}>
          Entente
        </h1>
        <p style={{ color: '#64748B', fontSize: '11px', marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: '600' }}>
          Plataforma de Oratoria Ejecutiva & Inteligencia Corporal
        </p>

        {/* Ventana de previsualización */}
        <div style={{ 
          width: '100%',
          height: '240px',
          backgroundColor: '#000',
          borderRadius: '12px',
          overflow: 'hidden',
          marginBottom: '16px',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)'
        }}>
          <video 
            ref={videoPreviewRef} 
            muted 
            playsInline 
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
          />
        </div>

        {/* Estado */}
        <div style={{ 
          padding: '12px 16px', 
          border: '1px solid #E2E8F0', 
          borderRadius: '8px',
          marginBottom: '16px',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
        }}>
          <p style={{ fontSize: '14px', margin: 0, fontWeight: '500', color: '#334155' }}>{estado}</p>
        </div>

        {/* Botón */}
        <button 
          onClick={grabando ? detenerGrabacion : iniciarGrabacion}
          style={{
            background: grabando ? '#EF4444' : '#2563EB',
            color: 'white',
            border: 'none',
            padding: '14px 24px',
            fontSize: '16px',
            fontWeight: '600',
            borderRadius: '8px',
            cursor: 'pointer',
            width: '100%',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
            marginBottom: '30px',
            transition: 'all 0.2s'
          }}
        >
          {grabando ? '⏹ Finalizar y Evaluar Sesión' : '📹 Iniciar Grabación Ejecutiva'}
        </button>

        {/* Dashboard de Resultados tipo Yoodli Mejorado */}
        {informe && (
          <div ref={resultadosRef} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Tarjeta de Fortaleza */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#16A34A', fontWeight: '600', fontSize: '15px' }}>
                <span>👍</span> Fortaleza: {informe.fortalezaTitulo}
              </div>
              <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', color: '#334155' }}>
                {informe.fortalezaDesc}
              </p>
            </div>

            {/* Tarjeta de Área de Crecimiento */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#D97706', fontWeight: '600', fontSize: '15px' }}>
                <span>🚩</span> Área de Crecimiento: {informe.areaCrecimientoTitulo}
              </div>
              <p style={{ margin: '0 0 12px 0', fontSize: '14px', lineHeight: '1.5', color: '#334155' }}>
                {informe.areaCrecimientoDesc}
              </p>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#475569', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {informe.consejosPracticos?.map((consejo: string, idx: number) => (
                  <li key={idx}><strong>Recomendación:</strong> {consejo}</li>
                ))}
              </ul>
            </div>

            {/* Tarjeta de Tono */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#0284C7', fontWeight: '600', fontSize: '15px' }}>
                <span>💡</span> Tono del Discurso
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {informe.tonosDetectados?.map((t: string, i: number) => (
                  <span key={i} style={{ background: '#E0F2FE', color: '#0369A1', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>
                    {t}
                  </span>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.5', color: '#334155' }}>
                {informe.analisisTono}
              </p>
            </div>

            {/* Tarjeta de Presencia Visual */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: '#7C3AED', fontWeight: '600', fontSize: '15px' }}>
                <span>👁️</span> Presencia Visual & Lenguaje Corporal
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {informe.presenciaVisualEtiquetas?.map((p: string, i: number) => (
                  <span key={i} style={{ background: '#EDE9FE', color: '#6D28D9', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>
                    {p}
                  </span>
                ))}
              </div>
              <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.5', color: '#334155' }}>
                {informe.analisisVisual}
              </p>
            </div>

            {/* Panel de Métricas Clave */}
            <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#1E293B' }}>📊 Métricas Cuantificables</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
                <div style={{ background: '#F8FAFC', padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <strong>Ritmo:</strong> {informe.metrics.ritmoPalabrasPorMinuto} ppm
                </div>
                <div style={{ background: '#F8FAFC', padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <strong>Contacto Visual:</strong> {informe.metrics.contactoVisualScore} ({informe.metrics.contactoVisualPorcentaje})
                </div>
                <div style={{ background: '#F8FAFC', padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <strong>Muletillas:</strong> {informe.metrics.muletillasDetectadas}
                </div>
                <div style={{ background: '#F8FAFC', padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <strong>Persuasión:</strong> {informe.metrics.persuasionScore}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}