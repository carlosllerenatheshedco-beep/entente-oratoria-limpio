'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/supabase';

type Phase = 'preparado' | 'grabando' | 'procesando' | 'listo' | 'error';

export default function Home() {
  const [estado, setEstado] = useState('Preparado para analizar tu intervencion.');
  const [fase, setFase] = useState<Phase>('preparado');
  const [grabando, setGrabando] = useState(false);
  const [exportandoPDF, setExportandoPDF] = useState(false);
  const [stylesMounted, setStylesMounted] = useState(false);
  const [informe, setInforme] = useState<any>(null);
  const [idioma, setIdioma] = useState('es-ES');
  const [contextoEntorno, setContextoEntorno] = useState('Comite de direccion o entorno corporativo');
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
      resultadosRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [informe]);

  useLayoutEffect(() => {
    setStylesMounted(true);
  }, []);

  const extraerAudioWav = async (videoBlob: Blob): Promise<Blob> => {
    const arrayBuffer = await videoBlob.arrayBuffer();
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });

    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const numOfChan = 1;
      const sampleRate = 16000;
      const length = audioBuffer.length * 2 + 44;
      const out = new ArrayBuffer(length);
      const view = new DataView(out);
      let pos = 0;

      const writeString = (str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(pos++, str.charCodeAt(i));
      };
      const setUint16 = (data: number) => {
        view.setUint16(pos, data, true);
        pos += 2;
      };
      const setUint32 = (data: number) => {
        view.setUint32(pos, data, true);
        pos += 4;
      };

      writeString('RIFF');
      setUint32(length - 8);
      writeString('WAVE');
      writeString('fmt ');
      setUint32(16);
      setUint16(1);
      setUint16(numOfChan);
      setUint32(sampleRate);
      setUint32(sampleRate * 2);
      setUint16(2);
      setUint16(16);
      writeString('data');
      setUint32(length - pos - 4);

      const channelData = audioBuffer.getChannelData(0);
      let offset = 0;
      while (offset < audioBuffer.length) {
        let sample = Math.max(-1, Math.min(1, channelData[offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true);
        pos += 2;
        offset++;
      }

      return new Blob([out], { type: 'audio/wav' });
    } finally {
      await audioCtx.close();
    }
  };

  const extraerFrames = async (videoBlob: Blob): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const extracted: string[] = [];
      const objectUrl = URL.createObjectURL(videoBlob);
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('No se han podido preparar los fotogramas clave de la intervencion.'));
      }, 20000);

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        URL.revokeObjectURL(objectUrl);
        video.onloadedmetadata = null;
        video.onseeked = null;
        video.onerror = null;
      };

      video.preload = 'metadata';
      video.muted = true;
      video.src = objectUrl;

      video.onerror = () => {
        cleanup();
        reject(new Error('No se ha podido leer el video seleccionado.'));
      };

      video.onloadedmetadata = async () => {
        try {
          const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
          const sampleCount = Math.min(18, Math.max(8, Math.ceil(duration / 5)));
          const interval = duration / sampleCount;
          canvas.width = 640;
          canvas.height = 360;

          for (let i = 0; i < sampleCount; i++) {
            const targetTime = Math.min(Math.max(i * interval, 0), Math.max(duration - 0.05, 0));

            await new Promise<void>((resolveSeek, rejectSeek) => {
              const seekTimeout = window.setTimeout(() => {
                rejectSeek(new Error('No se ha podido posicionar el video para capturar fotogramas.'));
              }, 3000);

              video.onseeked = () => {
                window.clearTimeout(seekTimeout);
                resolveSeek();
              };

              video.currentTime = targetTime;
            });

            if (ctx) {
              ctx.drawImage(video, 0, 0, 640, 360);
              extracted.push(canvas.toDataURL('image/jpeg', 0.55).split(',')[1]);
            }
          }

          cleanup();
          resolve(extracted);
        } catch (error: any) {
          cleanup();
          reject(error);
        }
      };
    });
  };

  const subirAudioTemporalASupabase = async (nombreAudio: string, wavBlob: Blob) => {
    const supabase = getSupabaseClient();
    const { error: uploadError } = await supabase.storage.from('audios-oratoria').upload(nombreAudio, wavBlob, {
      contentType: 'audio/wav',
      upsert: true,
    });

    if (uploadError) {
      throw new Error(`Error al subir el audio a Supabase: ${uploadError.message}`);
    }
  };

  const prepararAudioTemporalEnServidor = async (videoFile: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', videoFile, videoFile.name);

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json.error || 'No se ha podido preparar el audio del video subido.');
    }

    return json.fileName;
  };

  const solicitarAnalisis = async (fileName: string, frames: string[]) => {
    setEstado('Generando el informe ejecutivo...');

    const resAnalyze = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName,
        language: idioma,
        frames,
        contexto: contextoEntorno,
        audiencia: audienciaObjetivo,
        objetivo: objetivoDiscurso,
      }),
    });

    if (!resAnalyze.ok) {
      const errJson = await resAnalyze.json().catch(() => ({}));
      throw new Error(errJson.error || 'No se ha podido completar el analisis.');
    }

    const json = await resAnalyze.json();
    setInforme(json.data);
    setFase('listo');
    setEstado('Informe listo. El material temporal se ha eliminado.');
  };

  const procesarYEnviarMultimedia = async (
    videoBlob: Blob,
    options: { usarPreparacionLocal?: boolean } = {}
  ) => {
    setInforme(null);
    setFase('procesando');
    setEstado(options.usarPreparacionLocal ? 'Preparando video y fotogramas clave...' : 'Preparando audio y fotogramas clave...');

    try {
      const framesPromise = extraerFrames(videoBlob);
      let nombreAudio = '';

      if (options.usarPreparacionLocal && videoBlob instanceof File) {
        setEstado('Extrayendo audio del video en entorno local...');
        nombreAudio = await prepararAudioTemporalEnServidor(videoBlob);
      } else {
        const wavBlob = await extraerAudioWav(videoBlob);
        nombreAudio = `audio_entente_${Date.now()}.wav`;
        setEstado('Subiendo el material temporal para su analisis...');
        await subirAudioTemporalASupabase(nombreAudio, wavBlob);
      }

      const frames = await framesPromise;
      await solicitarAnalisis(nombreAudio, frames);
    } catch (error: any) {
      setFase('error');
      setEstado(`No hemos podido procesar la intervencion. ${error.message}`);
    }
  };

  const iniciarGrabacion = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: true,
      });

      streamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        void videoPreviewRef.current.play();
      }

      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'video/webm; codecs=vp8,opus',
        videoBitsPerSecond: 800000,
      });

      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null;
        }

        setFase('procesando');
        setEstado('Preparando la intervencion para su analisis...');
        const blobVideo = new Blob(chunksRef.current, { type: 'video/webm' });
        await procesarYEnviarMultimedia(blobVideo);
      };

      mediaRecorderRef.current.start();
      setGrabando(true);
      setFase('grabando');
      setEstado('Grabando intervencion...');
    } catch (error: any) {
      setFase('error');
      setEstado(`No hemos podido acceder a camara y microfono. ${error.message}`);
    }
  };

  const detenerGrabacion = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setGrabando(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const enLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
    await procesarYEnviarMultimedia(file, { usarPreparacionLocal: enLocal });
    event.target.value = '';
  };

  const esperarRenderPDF = () =>
    new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

  const obtenerPuntosDeCortePDF = (root: HTMLElement, renderScaleY: number) => {
    const rootRect = root.getBoundingClientRect();
    const points = new Set<number>();
    const nestedSelectors = [
      '.priority-item',
      '.improvement-item',
      '.metric-card',
      '.chart-card',
      '.audit-panel',
      '.observation-card',
      '.timeline-item',
    ];

    const addPoint = (value: number) => {
      const rounded = Math.round(value);
      if (rounded > 0) {
        points.add(rounded);
      }
    };

    Array.from(root.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      const rect = child.getBoundingClientRect();
      addPoint((rect.top - rootRect.top) * renderScaleY);
    });

    nestedSelectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const rect = node.getBoundingClientRect();
        addPoint((rect.top - rootRect.top) * renderScaleY);
      });
    });

    return Array.from(points).sort((a, b) => a - b);
  };

  const exportarPDF = async () => {
    if (!resultadosRef.current || exportandoPDF) return;

    const estadoPrevio = estado;
    let pdfGenerado = false;

    try {
      setExportandoPDF(true);
      setEstado('Generando PDF para descarga...');
      await esperarRenderPDF();

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const canvas = await html2canvas(resultadosRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        scrollY: -window.scrollY,
        windowWidth: document.documentElement.scrollWidth,
      });

      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const printableWidth = pageWidth - margin * 2;
      const printableHeight = pageHeight - margin * 2;
      const pageHeightPx = Math.floor((printableHeight * canvas.width) / printableWidth);
      const renderScaleY = canvas.height / resultadosRef.current.scrollHeight;
      const puntosDeCorte = obtenerPuntosDeCortePDF(resultadosRef.current, renderScaleY);
      const minSliceHeightPx = Math.floor(pageHeightPx * 0.55);

      let currentY = 0;
      let pageIndex = 0;

      while (currentY < canvas.height) {
        let nextY = Math.min(currentY + pageHeightPx, canvas.height);

        if (nextY < canvas.height) {
          const corteNatural = puntosDeCorte
            .filter((point) => point > currentY + minSliceHeightPx && point <= nextY)
            .pop();

          if (corteNatural) {
            nextY = corteNatural;
          }
        }

        const sliceHeight = Math.max(1, nextY - currentY);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeight;

        const pageContext = pageCanvas.getContext('2d');
        if (!pageContext) {
          throw new Error('No se ha podido preparar una pagina intermedia del PDF.');
        }

        pageContext.fillStyle = '#ffffff';
        pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        pageContext.drawImage(canvas, 0, currentY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

        const pageImgData = pageCanvas.toDataURL('image/png');
        const pageImageHeight = (sliceHeight * printableWidth) / canvas.width;

        if (pageIndex > 0) {
          pdf.addPage();
        }

        pdf.addImage(pageImgData, 'PNG', margin, margin, printableWidth, pageImageHeight, undefined, 'FAST');

        currentY = nextY;
        pageIndex += 1;
      }

      pdf.save(`entente-informe-${new Date().toISOString().slice(0, 10)}.pdf`);
      pdfGenerado = true;
    } catch (error: any) {
      setFase('error');
      setEstado(`No hemos podido generar el PDF. ${error?.message || 'Intentalo de nuevo.'}`);
    } finally {
      setExportandoPDF(false);
      if (pdfGenerado) {
        setEstado(estadoPrevio);
      }
    }
  };

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

  const getConfidenceTheme = (confianza?: string) => {
    const normalized = (confianza || '').toLowerCase();
    if (normalized.includes('alta')) {
      return { background: '#201F1F', color: '#F7F3EB' };
    }
    if (normalized.includes('media')) {
      return { background: '#E7C257', color: '#201F1F' };
    }
    return { background: '#8E3631', color: '#F7F3EB' };
  };

  const getImpactTheme = (impacto?: string) => {
    const normalized = (impacto || '').toLowerCase();
    if (normalized.includes('alto')) return '#8E3631';
    if (normalized.includes('medio')) return '#E7C257';
    return '#201F1F';
  };

  const getStatusClassName = () => {
    if (fase === 'error') return 'status-card status-error';
    if (fase === 'listo') return 'status-card status-success';
    if (fase === 'grabando' || fase === 'procesando') return 'status-card status-processing';
    return 'status-card status-idle';
  };

  const getActiveStep = () => {
    if (informe || fase === 'listo') return 3;
    if (grabando || fase === 'procesando') return 2;
    return 1;
  };

  const step = getActiveStep();
  const persuasionTotal = informe?.rubricaPersuasion?.total || 0;
  const ritmoMedio = informe?.datosDuros?.ritmoPalabrasPorMinuto || 0;
  const disfluencias = informe?.datosDuros?.muletillasDetectadas || 0;
  const confianzaVisual = informe?.auditoriaVisual?.ejeMirada?.confianza || 'No evaluada';
  const palancasMejora = informe?.top3PalancasCrecimiento || [];
  const primeraPalanca = palancasMejora[0];
  const segundaPalanca = palancasMejora[1] || palancasMejora[0];
  const resumenEjecutivo =
    informe?.rubricaPersuasion?.justificacionGlobal ||
    'El informe aparecera aqui con una lectura ejecutiva de la intervencion.';
  const rubricaLecturas = [
    {
      label: 'Claridad de tesis',
      score: informe?.rubricaPersuasion?.claridadTesis || 0,
      helper: 'La idea principal se entiende y se sostiene durante la intervencion.',
    },
    {
      label: 'Relevancia para la audiencia',
      score: informe?.rubricaPersuasion?.relevanciaAudiencia || 0,
      helper: 'La intervencion conecta con lo que la audiencia necesita decidir o escuchar.',
    },
    {
      label: 'Construccion retorica',
      score: informe?.rubricaPersuasion?.construccionRetorica || 0,
      helper: 'La secuencia de argumentos ayuda a avanzar sin ruido ni dispersion.',
    },
    {
      label: 'Cierre y movilizacion',
      score: informe?.rubricaPersuasion?.cierreMovilizacion || 0,
      helper: 'La ultima idea deja direccion, criterio o llamada a la accion.',
    },
    {
      label: 'Adecuacion al contexto',
      score: informe?.rubricaPersuasion?.adecuacionContexto || 0,
      helper: 'El tono y el enfoque encajan con el escenario de intervencion definido.',
    },
  ];
  const fortalezaBase = [...rubricaLecturas].sort((a, b) => b.score - a.score)[0];
  const siguientePasoRecomendado = primeraPalanca
    ? `Repetir la intervencion en un nuevo ensayo centrando la mejora en ${primeraPalanca.comportamiento.toLowerCase()}.`
    : `Preparar una siguiente ronda en el contexto "${contextoEntorno}" con foco en ${objetivoDiscurso.toLowerCase()}.`;

  const MetricCard = ({ label, value, helper }: { label: string; value: string; helper?: string }) => (
    <article className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {helper ? <span className="metric-helper">{helper}</span> : null}
    </article>
  );

  const ObservationCard = ({
    title,
    observation,
    interpretation,
    confidence,
  }: {
    title: string;
    observation: string;
    interpretation: string;
    confidence: string;
  }) => {
    const confidenceTheme = getConfidenceTheme(confidence);

    return (
      <article className="observation-card">
        <div className="observation-head">
          <h4>{title}</h4>
          <span className="confidence-badge" style={confidenceTheme}>
            {confidence}
          </span>
        </div>
        <p>
          <strong>Observacion.</strong> {observation}
        </p>
        <p>
          <strong>Interpretacion.</strong> {interpretation}
        </p>
      </article>
    );
  };

  return (
    <main className={`entente-page ${exportandoPDF ? 'pdf-exporting' : ''}`}>
      {stylesMounted ? <style>{`
        :root {
          --entente-paper: #f7f3eb;
          --entente-paper-strong: #f2ebdd;
          --entente-ink: #201f1f;
          --entente-carmesi: #8e3631;
          --entente-gold: #e7c257;
          --entente-border: rgba(32, 31, 31, 0.12);
          --entente-soft-line: rgba(142, 54, 49, 0.16);
          --entente-shadow: 0 24px 60px rgba(32, 31, 31, 0.08);
          --entente-serif: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
          --entente-sans: 'Aptos', 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        body {
          margin: 0;
          color: var(--entente-ink);
          background:
            radial-gradient(circle at top left, rgba(231, 194, 87, 0.18), transparent 28%),
            linear-gradient(180deg, #fcfaf5 0%, var(--entente-paper) 100%);
          font-family: var(--entente-sans);
        }

        .entente-page {
          min-height: 100vh;
          padding: 36px 20px 80px;
          color: var(--entente-ink);
        }

        .shell {
          width: min(1180px, 100%);
          margin: 0 auto;
          position: relative;
        }

        .shell::before {
          content: '';
          position: absolute;
          top: 54px;
          right: 0;
          width: 240px;
          height: 240px;
          opacity: 0.06;
          pointer-events: none;
          background:
            radial-gradient(circle at 25% 25%, var(--entente-carmesi) 0 22%, transparent 23%),
            radial-gradient(circle at 75% 25%, var(--entente-gold) 0 22%, transparent 23%),
            radial-gradient(circle at 25% 75%, var(--entente-gold) 0 22%, transparent 23%),
            radial-gradient(circle at 75% 75%, var(--entente-carmesi) 0 22%, transparent 23%);
          background-size: 120px 120px;
          border-radius: 32px;
        }

        .hero {
          display: flex;
          flex-direction: column;
          gap: 18px;
          margin-bottom: 28px;
        }

        .brand-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }

        .brand-mark {
          font-family: var(--entente-sans);
          font-size: clamp(32px, 5vw, 54px);
          font-weight: 800;
          letter-spacing: -0.04em;
          text-transform: lowercase;
        }

        .confidential-chip {
          border: 1px solid var(--entente-border);
          border-radius: 999px;
          padding: 10px 14px;
          background: rgba(255, 255, 255, 0.76);
          color: rgba(32, 31, 31, 0.76);
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .hero-copy {
          width: min(720px, 100%);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .hero-copy h1 {
          margin: 0;
          font-family: var(--entente-serif);
          font-size: clamp(42px, 6vw, 70px);
          line-height: 0.96;
          font-weight: 400;
          letter-spacing: -0.03em;
        }

        .hero-copy p {
          margin: 0;
          color: rgba(32, 31, 31, 0.74);
          font-size: 18px;
          line-height: 1.6;
          max-width: 640px;
        }

        .steps {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-top: 6px;
        }

        .step-card {
          border: 1px solid var(--entente-border);
          background: rgba(255, 255, 255, 0.78);
          border-radius: 18px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .step-card strong {
          font-size: 13px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(32, 31, 31, 0.52);
        }

        .step-card span {
          font-size: 18px;
          font-family: var(--entente-serif);
          color: rgba(32, 31, 31, 0.56);
        }

        .step-card.is-active {
          border-color: rgba(142, 54, 49, 0.28);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(247, 243, 235, 0.96));
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85);
        }

        .step-card.is-active strong,
        .step-card.is-active span {
          color: var(--entente-carmesi);
        }

        .top-grid {
          display: grid;
          grid-template-columns: 360px minmax(0, 1fr);
          gap: 22px;
          align-items: start;
          margin-bottom: 22px;
        }

        .panel {
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid var(--entente-border);
          border-radius: 28px;
          box-shadow: var(--entente-shadow);
          overflow: hidden;
        }

        .panel-body {
          padding: 28px;
        }

        .panel-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--entente-carmesi);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          margin-bottom: 20px;
        }

        .context-summary {
          display: grid;
          gap: 14px;
        }

        .summary-row {
          display: grid;
          gap: 4px;
          padding-bottom: 14px;
          border-bottom: 1px solid rgba(32, 31, 31, 0.08);
        }

        .summary-row:last-of-type {
          border-bottom: none;
          padding-bottom: 0;
        }

        .summary-row span {
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(32, 31, 31, 0.46);
        }

        .summary-row strong {
          font-size: 16px;
          line-height: 1.45;
          font-weight: 600;
        }

        .link-button {
          margin-top: 20px;
          border: none;
          background: transparent;
          color: var(--entente-carmesi);
          font-size: 14px;
          font-weight: 700;
          padding: 0;
          cursor: pointer;
        }

        .context-form {
          display: grid;
          gap: 16px;
          margin-top: 22px;
          padding-top: 22px;
          border-top: 1px solid rgba(32, 31, 31, 0.08);
        }

        .context-form label {
          display: grid;
          gap: 7px;
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(32, 31, 31, 0.5);
        }

        .context-form input,
        .context-form select {
          width: 100%;
          padding: 14px 16px;
          border-radius: 16px;
          border: 1px solid rgba(32, 31, 31, 0.14);
          background: #fffdf8;
          color: var(--entente-ink);
          font-size: 15px;
          box-sizing: border-box;
          font-family: var(--entente-sans);
        }

        .context-inline {
          display: grid;
          grid-template-columns: 1fr 160px;
          gap: 12px;
        }

        .capture-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 18px;
        }

        .capture-title {
          display: grid;
          gap: 8px;
        }

        .capture-title h2,
        .report-title h2 {
          margin: 0;
          font-family: var(--entente-serif);
          font-size: clamp(32px, 4.5vw, 42px);
          line-height: 1;
          font-weight: 400;
          letter-spacing: -0.03em;
        }

        .capture-title p,
        .report-title p {
          margin: 0;
          color: rgba(32, 31, 31, 0.68);
          font-size: 15px;
          line-height: 1.5;
        }

        .video-shell {
          border-radius: 24px;
          overflow: hidden;
          background:
            radial-gradient(circle at top right, rgba(231, 194, 87, 0.16), transparent 26%),
            linear-gradient(180deg, #1d1c1c 0%, #090909 100%);
          border: 1px solid rgba(32, 31, 31, 0.26);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }

        .video-frame {
          width: 100%;
          aspect-ratio: 16 / 9;
          display: block;
          object-fit: cover;
          transform: scaleX(-1);
        }

        .status-card {
          margin-top: 18px;
          padding: 16px 18px;
          border-radius: 18px;
          border: 1px solid var(--entente-border);
          display: grid;
          gap: 6px;
        }

        .status-card strong {
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .status-card p {
          margin: 0;
          font-size: 15px;
          line-height: 1.5;
          font-weight: 600;
        }

        .status-idle {
          background: rgba(255, 255, 255, 0.72);
        }

        .status-idle strong {
          color: rgba(32, 31, 31, 0.5);
        }

        .status-processing {
          background: rgba(231, 194, 87, 0.12);
          border-color: rgba(231, 194, 87, 0.4);
        }

        .status-processing strong {
          color: rgba(32, 31, 31, 0.56);
        }

        .status-success {
          background: rgba(142, 54, 49, 0.08);
          border-color: rgba(142, 54, 49, 0.25);
        }

        .status-success strong {
          color: var(--entente-carmesi);
        }

        .status-error {
          background: rgba(142, 54, 49, 0.08);
          border-color: rgba(142, 54, 49, 0.28);
        }

        .status-error strong {
          color: var(--entente-carmesi);
        }

        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 18px;
        }

        .primary-button,
        .secondary-button,
        .ghost-button {
          appearance: none;
          border: none;
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
          font-family: var(--entente-sans);
        }

        .primary-button:hover,
        .secondary-button:hover,
        .ghost-button:hover {
          transform: translateY(-1px);
        }

        .primary-button:disabled,
        .secondary-button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          transform: none;
        }

        .primary-button {
          min-width: 220px;
          padding: 16px 24px;
          border-radius: 18px;
          background: var(--entente-ink);
          color: var(--entente-paper);
          font-size: 16px;
          font-weight: 700;
          box-shadow: 0 18px 30px rgba(32, 31, 31, 0.16);
        }

        .secondary-button {
          min-width: 220px;
          padding: 16px 24px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.8);
          color: var(--entente-ink);
          font-size: 16px;
          font-weight: 700;
          border: 1px solid rgba(32, 31, 31, 0.14);
        }

        .ghost-button {
          padding: 11px 14px;
          border-radius: 999px;
          background: rgba(142, 54, 49, 0.08);
          color: var(--entente-carmesi);
          font-size: 13px;
          font-weight: 700;
        }

        .privacy-strip {
          display: grid;
          gap: 14px;
          padding: 20px 24px;
          border-radius: 24px;
          border: 1px solid var(--entente-border);
          background: rgba(255, 255, 255, 0.76);
          box-shadow: var(--entente-shadow);
          margin-bottom: 22px;
        }

        .privacy-strip p,
        .privacy-strip li {
          margin: 0;
          color: rgba(32, 31, 31, 0.76);
          line-height: 1.55;
          font-size: 14px;
        }

        .privacy-strip strong {
          color: var(--entente-ink);
        }

        .privacy-disclosure {
          border-top: 1px solid rgba(32, 31, 31, 0.08);
          padding-top: 14px;
        }

        .privacy-disclosure summary {
          cursor: pointer;
          list-style: none;
          font-weight: 700;
          color: var(--entente-carmesi);
          font-size: 14px;
        }

        .privacy-disclosure summary::-webkit-details-marker {
          display: none;
        }

        .privacy-disclosure-body {
          display: grid;
          gap: 10px;
          margin-top: 14px;
        }

        .privacy-disclosure-body a {
          color: var(--entente-carmesi);
          text-decoration: none;
          font-weight: 700;
        }

        .report-shell {
          display: grid;
          gap: 22px;
          margin-top: 22px;
        }

        .report-panel {
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid var(--entente-border);
          border-radius: 28px;
          box-shadow: var(--entente-shadow);
          padding: 28px;
        }

        .report-head {
          display: flex;
          justify-content: space-between;
          align-items: end;
          gap: 16px;
          margin-bottom: 24px;
        }

        .report-title {
          display: grid;
          gap: 8px;
        }

        .pdf-button {
          padding: 14px 18px;
          border-radius: 18px;
          border: none;
          background: var(--entente-carmesi);
          color: var(--entente-paper);
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
        }

        .placeholder-report {
          border: 1px dashed rgba(32, 31, 31, 0.18);
          border-radius: 22px;
          padding: 26px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.54), rgba(247, 243, 235, 0.7));
        }

        .placeholder-report h3,
        .section-title {
          margin: 0 0 10px;
          font-family: var(--entente-serif);
          font-size: 30px;
          line-height: 1;
          font-weight: 400;
        }

        .placeholder-report p {
          margin: 0;
          font-size: 15px;
          line-height: 1.6;
          color: rgba(32, 31, 31, 0.7);
          max-width: 680px;
        }

        .executive-summary {
          display: grid;
          gap: 18px;
        }

        .thesis-card {
          border-radius: 24px;
          background: linear-gradient(135deg, rgba(142, 54, 49, 0.08), rgba(255, 255, 255, 0.78));
          border: 1px solid rgba(142, 54, 49, 0.14);
          padding: 24px;
          display: grid;
          gap: 10px;
        }

        .thesis-card span {
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--entente-carmesi);
          font-weight: 700;
        }

        .thesis-card p {
          margin: 0;
          font-size: 19px;
          line-height: 1.58;
          font-family: var(--entente-serif);
        }

        .metric-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .metric-card {
          border: 1px solid rgba(32, 31, 31, 0.1);
          background: rgba(255, 255, 255, 0.78);
          border-radius: 20px;
          padding: 20px;
          display: grid;
          gap: 8px;
          min-height: 128px;
        }

        .metric-label {
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(32, 31, 31, 0.46);
        }

        .metric-value {
          font-family: var(--entente-serif);
          font-size: 36px;
          line-height: 1;
          font-weight: 400;
        }

        .metric-helper {
          font-size: 13px;
          color: rgba(32, 31, 31, 0.64);
          line-height: 1.45;
        }

        .chart-card {
          border: 1px solid rgba(32, 31, 31, 0.1);
          border-radius: 24px;
          padding: 20px;
          background: rgba(255, 255, 255, 0.74);
        }

        .chart-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }

        .chart-head h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
        }

        .chart-head span {
          font-size: 13px;
          color: rgba(32, 31, 31, 0.56);
        }

        .priority-card {
          border-radius: 24px;
          padding: 22px 24px;
          border: 1px solid rgba(32, 31, 31, 0.1);
          background: rgba(255, 255, 255, 0.78);
        }

        .priority-list {
          display: grid;
          gap: 14px;
          margin-top: 16px;
        }

        .priority-item {
          display: grid;
          gap: 10px;
          padding: 16px 0 0;
          border-top: 1px solid rgba(32, 31, 31, 0.08);
        }

        .priority-item:first-of-type {
          border-top: none;
          padding-top: 0;
        }

        .priority-head {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 16px;
        }

        .priority-title {
          display: flex;
          gap: 12px;
          align-items: baseline;
        }

        .priority-index {
          font-family: var(--entente-serif);
          font-size: 24px;
          color: var(--entente-carmesi);
        }

        .priority-title h4 {
          margin: 0;
          font-size: 18px;
          line-height: 1.4;
        }

        .impact-badge {
          border-radius: 999px;
          padding: 7px 10px;
          color: var(--entente-paper);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .priority-item p {
          margin: 0;
          color: rgba(32, 31, 31, 0.76);
          line-height: 1.58;
          font-size: 14px;
        }

        .improvement-card,
        .evidence-card,
        .print-cover {
          border-radius: 24px;
          border: 1px solid rgba(32, 31, 31, 0.1);
          background: rgba(255, 255, 255, 0.78);
        }

        .improvement-card,
        .evidence-card {
          padding: 24px;
        }

        .improvement-intro,
        .evidence-intro {
          margin: 0 0 18px;
          color: rgba(32, 31, 31, 0.74);
          line-height: 1.58;
          font-size: 14px;
        }

        .improvement-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .improvement-item {
          border-radius: 20px;
          border: 1px solid rgba(32, 31, 31, 0.08);
          padding: 18px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(247, 243, 235, 0.82));
          display: grid;
          gap: 8px;
        }

        .improvement-item span {
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(32, 31, 31, 0.46);
        }

        .improvement-item strong {
          font-size: 18px;
          line-height: 1.35;
        }

        .improvement-item p {
          margin: 0;
          color: rgba(32, 31, 31, 0.74);
          line-height: 1.58;
          font-size: 14px;
        }

        .evidence-stack {
          display: grid;
          gap: 18px;
        }

        .print-only {
          display: none;
        }

        .pdf-exporting .print-only {
          display: block !important;
        }

        .pdf-exporting .pdf-button {
          opacity: 0.7;
          cursor: wait;
        }

        .print-cover {
          padding: 40px 34px;
          display: grid;
          gap: 18px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 243, 235, 0.98));
        }

        .print-cover h2 {
          margin: 0;
          font-family: var(--entente-serif);
          font-size: 46px;
          line-height: 1.02;
          font-weight: 400;
        }

        .print-cover p {
          margin: 0;
          color: rgba(32, 31, 31, 0.76);
          line-height: 1.6;
          font-size: 15px;
        }

        .print-cover-intro {
          max-width: 760px;
          margin-top: 8px !important;
          color: rgba(32, 31, 31, 0.68) !important;
          font-size: 14px !important;
          line-height: 1.7 !important;
        }

        .print-cover-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .print-cover-item {
          border-top: 1px solid rgba(32, 31, 31, 0.08);
          padding-top: 12px;
          display: grid;
          gap: 6px;
        }

        .print-cover-item span {
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(32, 31, 31, 0.46);
        }

        .print-cover-item strong {
          font-size: 17px;
          line-height: 1.4;
        }

        .audit-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
        }

        .audit-panel {
          border: 1px solid rgba(32, 31, 31, 0.1);
          border-radius: 24px;
          padding: 22px;
          background: rgba(255, 255, 255, 0.78);
        }

        .audit-panel h3 {
          margin: 0 0 18px;
          font-family: var(--entente-serif);
          font-size: 28px;
          line-height: 1;
          font-weight: 400;
        }

        .observation-list {
          display: grid;
          gap: 12px;
        }

        .observation-card {
          border-radius: 18px;
          padding: 18px;
          border: 1px solid rgba(32, 31, 31, 0.1);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(247, 243, 235, 0.82));
          display: grid;
          gap: 10px;
        }

        .observation-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        .observation-head h4 {
          margin: 0;
          font-size: 17px;
        }

        .observation-card p {
          margin: 0;
          color: rgba(32, 31, 31, 0.76);
          font-size: 14px;
          line-height: 1.58;
        }

        .confidence-badge {
          border-radius: 999px;
          padding: 7px 10px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .timeline-card {
          border-radius: 24px;
          border: 1px solid rgba(32, 31, 31, 0.1);
          padding: 24px;
          background: rgba(255, 255, 255, 0.78);
        }

        .timeline-list {
          display: grid;
          gap: 14px;
          margin-top: 18px;
        }

        .timeline-item {
          display: grid;
          grid-template-columns: 90px minmax(0, 1fr);
          gap: 18px;
          padding-top: 14px;
          border-top: 1px solid rgba(32, 31, 31, 0.08);
        }

        .timeline-item:first-of-type {
          border-top: none;
          padding-top: 0;
        }

        .timeline-time {
          font-family: var(--entente-serif);
          font-size: 24px;
          color: var(--entente-carmesi);
        }

        .timeline-copy {
          display: grid;
          gap: 6px;
        }

        .timeline-copy blockquote {
          margin: 0;
          padding: 0;
          border: none;
          font-family: var(--entente-serif);
          font-size: 21px;
          line-height: 1.4;
          color: var(--entente-ink);
        }

        .timeline-copy p {
          margin: 0;
          color: rgba(32, 31, 31, 0.74);
          line-height: 1.58;
          font-size: 14px;
        }

        .no-print {
          display: initial;
        }

        @media (max-width: 980px) {
          .top-grid,
          .audit-grid {
            grid-template-columns: 1fr;
          }

          .metric-grid,
          .improvement-grid,
          .print-cover-grid {
            grid-template-columns: 1fr 1fr;
          }

          .report-head,
          .capture-head,
          .brand-row {
            align-items: start;
            flex-direction: column;
          }

          .report-head {
            align-items: stretch;
          }

          .pdf-button {
            width: 100%;
          }
        }

        @media (max-width: 720px) {
          .entente-page {
            padding: 24px 14px 60px;
          }

          .panel-body,
          .report-panel,
          .privacy-strip {
            padding: 22px;
          }

          .steps,
          .metric-grid,
          .context-inline,
          .improvement-grid,
          .print-cover-grid {
            grid-template-columns: 1fr;
          }

          .actions {
            flex-direction: column;
          }

          .primary-button,
          .secondary-button {
            width: 100%;
          }

          .timeline-item {
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .timeline-time {
            font-size: 22px;
          }
        }

        @media print {
          .no-print,
          .confidential-chip,
          .steps,
          .privacy-disclosure,
          .pdf-button {
            display: none !important;
          }

          body {
            background: #ffffff !important;
          }

          .panel,
          .report-panel,
          .privacy-strip,
          .priority-card,
          .improvement-card,
          .evidence-card,
          .timeline-card,
          .audit-panel,
          .print-cover {
            box-shadow: none !important;
            border: 1px solid rgba(32, 31, 31, 0.18) !important;
            background: #ffffff !important;
          }

          .hero {
            margin-bottom: 16px;
          }

          .print-only {
            display: block !important;
          }

          .print-cover {
            break-after: page;
          }

          .priority-card,
          .improvement-card,
          .evidence-card,
          .timeline-card,
          .audit-panel {
            break-inside: avoid;
          }
        }
      `}</style> : null}

      <div className="shell">
        <section className="hero">
          <div className="brand-row">
            <div className="brand-mark">entente</div>
            <div className="confidential-chip">Confidencial</div>
          </div>

          <div className="hero-copy">
            <h1>Diagnostico de intervencion ejecutiva</h1>
            <p>
              Evalua claridad, persuasion, estructura y presencia para priorizar lo que realmente mueve una decision.
            </p>
          </div>

          <nav className="steps no-print" aria-label="Fases del proceso">
            <div className={`step-card ${step === 1 ? 'is-active' : ''}`}>
              <strong>01</strong>
              <span>Contexto</span>
            </div>
            <div className={`step-card ${step === 2 ? 'is-active' : ''}`}>
              <strong>02</strong>
              <span>Intervencion</span>
            </div>
            <div className={`step-card ${step === 3 ? 'is-active' : ''}`}>
              <strong>03</strong>
              <span>Informe</span>
            </div>
          </nav>
        </section>

        <section className="top-grid">
          <article className="panel no-print">
            <div className="panel-body">
              <div className="panel-eyebrow">Contexto de la intervencion</div>

              <div className="context-summary">
                <div className="summary-row">
                  <span>Formato</span>
                  <strong>{contextoEntorno}</strong>
                </div>
                <div className="summary-row">
                  <span>Audiencia</span>
                  <strong>{audienciaObjetivo}</strong>
                </div>
                <div className="summary-row">
                  <span>Objetivo</span>
                  <strong>{objetivoDiscurso}</strong>
                </div>
                <div className="summary-row">
                  <span>Idioma</span>
                  <strong>{idioma === 'es-MX' ? 'Espanol LATAM' : 'Espanol de Espana'}</strong>
                </div>
              </div>

              <button className="link-button" onClick={() => setMostrarConfiguracion(!mostrarConfiguracion)}>
                {mostrarConfiguracion ? 'Ocultar detalles' : 'Editar contexto'}
              </button>

              {mostrarConfiguracion ? (
                <div className="context-form">
                  <label>
                    Entorno o formato
                    <select value={contextoEntorno} onChange={(e) => setContextoEntorno(e.target.value)}>
                      <option value="Comite de direccion o entorno corporativo">Comite de direccion / Junta</option>
                      <option value="Pitch de ventas B2B">Pitch comercial / Ventas B2B</option>
                      <option value="Daily meeting o reunion de equipo corta">Daily / Reunion de equipo</option>
                      <option value="Presentacion magistral tipo TED">Presentacion magistral / Tipo TED</option>
                      <option value="Comunicacion de crisis a empleados">Comunicacion de crisis / Interna</option>
                    </select>
                  </label>

                  <label>
                    Audiencia principal
                    <input
                      type="text"
                      value={audienciaObjetivo}
                      onChange={(e) => setAudienciaObjetivo(e.target.value)}
                      placeholder="Ej. Direccion, inversores, equipo tecnico..."
                    />
                  </label>

                  <div className="context-inline">
                    <label>
                      Objetivo
                      <input
                        type="text"
                        value={objetivoDiscurso}
                        onChange={(e) => setObjetivoDiscurso(e.target.value)}
                        placeholder="Ej. Aprobar presupuesto"
                      />
                    </label>

                    <label>
                      Idioma
                      <select value={idioma} onChange={(e) => setIdioma(e.target.value)}>
                        <option value="es-ES">ES</option>
                        <option value="es-MX">LATAM</option>
                      </select>
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <div className="panel-body">
              <div className="capture-head">
                <div className="capture-title">
                  <div className="panel-eyebrow">Vista previa</div>
                  <h2>Intervencion</h2>
                  <p>Graba o sube una intervencion y recibe un informe ejecutivo ordenado por criterio, no por ruido.</p>
                </div>

                <button className="ghost-button no-print" type="button">
                  Uso confidencial
                </button>
              </div>

              <div className="video-shell">
                <video ref={videoPreviewRef} muted playsInline className="video-frame" />
              </div>

              <div className={getStatusClassName()}>
                <strong>Estado</strong>
                <p>{estado}</p>
              </div>

              <div className="actions no-print">
                <button className="primary-button" onClick={grabando ? detenerGrabacion : iniciarGrabacion} disabled={fase === 'procesando'}>
                  {grabando ? 'Finalizar y generar informe' : 'Iniciar grabacion ejecutiva'}
                </button>

                {!grabando ? (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept="video/mp4,video/webm,video/quicktime"
                      style={{ display: 'none' }}
                    />
                    <button
                      className="secondary-button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={fase === 'procesando'}
                    >
                      Subir video pregrabado
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        </section>

        <section className="privacy-strip">
          <p>
            <strong>Proteccion de datos.</strong> Al iniciar la evaluacion o subir una intervencion, autorizas el tratamiento del video, el audio y los datos de contexto necesarios para generar tu informe individual. El video original se procesa en tu navegador y los archivos temporales se eliminan automaticamente al finalizar el analisis.
          </p>

          <details className="privacy-disclosure">
            <summary>Mas informacion sobre privacidad y derechos</summary>
            <div className="privacy-disclosure-body">
              <p>
                Tratamos el video, el audio y los datos de contexto que aportas con la unica finalidad de generar el informe solicitado y mostrarte el resultado dentro de la plataforma.
              </p>
              <p>
                La base juridica del tratamiento es tu consentimiento, prestado al grabar o cargar voluntariamente una intervencion para su evaluacion. El video original no se conserva como fichero fuente en el servidor.
              </p>
              <p>
                Para completar el analisis se crea un audio temporal en el entorno tecnico de procesamiento. Ese archivo se elimina automaticamente al terminar el analisis y tambien cuando el proceso no llega a completarse.
              </p>
              <p>
                La informacion completa del responsable y del canal de ejercicio de derechos se rige por la politica de privacidad corporativa aplicable a este servicio. Si consideras que el tratamiento no se ajusta a la normativa, puedes reclamar ante la{' '}
                <a href="https://www.aepd.es/" target="_blank" rel="noreferrer">
                  Agencia Espanola de Proteccion de Datos
                </a>
                .
              </p>
            </div>
          </details>
        </section>

        <section className="report-shell" ref={resultadosRef}>
          {informe ? (
            <article className="print-cover print-only">
              <div className="panel-eyebrow">Entente · Documento confidencial</div>
              <h2>Diagnostico de intervencion ejecutiva</h2>
              <p className="print-cover-intro">
                Informe completo para revision y entrega. Incluye resumen ejecutivo, palancas de mejora, diagnostico
                verbal y visual, datos de apoyo y evidencias clave.
              </p>

              <div className="print-cover-grid">
                <div className="print-cover-item">
                  <span>Fecha del informe</span>
                  <strong>{new Date().toLocaleDateString('es-ES')}</strong>
                </div>
                <div className="print-cover-item">
                  <span>Formato</span>
                  <strong>{contextoEntorno}</strong>
                </div>
                <div className="print-cover-item">
                  <span>Audiencia</span>
                  <strong>{audienciaObjetivo}</strong>
                </div>
                <div className="print-cover-item">
                  <span>Objetivo</span>
                  <strong>{objetivoDiscurso}</strong>
                </div>
              </div>
            </article>
          ) : null}

          <article className="report-panel">
            <div className="report-head">
              <div className="report-title">
                <div className="panel-eyebrow">Informe</div>
                <h2>Resumen ejecutivo</h2>
                <p>Una lectura ordenada para facilitar comprension, criterio y accion.</p>
              </div>

              {informe ? (
                <button className="pdf-button no-print" onClick={exportarPDF} disabled={exportandoPDF}>
                  {exportandoPDF ? 'Generando PDF...' : 'Descargar informe en PDF'}
                </button>
              ) : null}
            </div>

            {!informe ? (
              <div className="placeholder-report">
                <h3>El informe aparecera aqui</h3>
                <p>
                  Cuando termine la evaluacion, esta seccion mostrara una tesis principal, las palancas prioritarias y
                  el plan de mejora antes de entrar en el detalle tecnico.
                </p>
              </div>
            ) : (
              <div className="executive-summary">
                <div className="thesis-card">
                  <span>Lectura principal</span>
                  <p>{resumenEjecutivo}</p>
                </div>
              </div>
            )}
          </article>

          {informe ? (
            <>
              <article className="priority-card">
                <h3 className="section-title">Palancas prioritarias</h3>
                <div className="priority-list">
                  {informe.top3PalancasCrecimiento?.map((palanca: any, idx: number) => (
                    <div key={idx} className="priority-item">
                      <div className="priority-head">
                        <div className="priority-title">
                          <span className="priority-index">{idx + 1}</span>
                          <h4>{palanca.comportamiento}</h4>
                        </div>
                        <span className="impact-badge" style={{ background: getImpactTheme(palanca.impacto) }}>
                          Impacto {palanca.impacto}
                        </span>
                      </div>

                      <p>
                        <strong>Evidencia.</strong> {palanca.evidenciaObservada}
                      </p>
                      <p>
                        <strong>Recomendacion.</strong> {palanca.recomendacion}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="improvement-card">
                <h3 className="section-title">Plan de mejora</h3>
                <p className="improvement-intro">
                  Sintesis operativa para convertir el diagnostico en trabajo concreto antes de la siguiente ronda.
                </p>

                <div className="improvement-grid">
                  <article className="improvement-item">
                    <span>Mantener</span>
                    <strong>{fortalezaBase.label}</strong>
                    <p>{fortalezaBase.helper}</p>
                  </article>

                  <article className="improvement-item">
                    <span>Corregir primero</span>
                    <strong>{primeraPalanca?.comportamiento || 'Pendiente de revision'}</strong>
                    <p>{primeraPalanca?.recomendacion || 'La primera palanca de mejora aparecera aqui.'}</p>
                  </article>

                  <article className="improvement-item">
                    <span>Entrenar despues</span>
                    <strong>{segundaPalanca?.comportamiento || 'Consolidar la estructura global'}</strong>
                    <p>{segundaPalanca?.recomendacion || 'La segunda prioridad de entrenamiento aparecera aqui.'}</p>
                  </article>

                  <article className="improvement-item">
                    <span>Siguiente paso</span>
                    <strong>Siguiente ronda recomendada</strong>
                    <p>{siguientePasoRecomendado}</p>
                  </article>
                </div>
              </article>

              <article className="evidence-card">
                <h3 className="section-title">Datos y evidencias</h3>
                <p className="evidence-intro">
                  Señales cuantitativas y trazas objetivas que apoyan la lectura ejecutiva del informe.
                </p>

                <div className="evidence-stack">
                  <div className="metric-grid">
                    <MetricCard label="Indice de persuasion" value={`${persuasionTotal} / 10`} helper="Lectura sintesis de la estructura persuasiva." />
                    <MetricCard label="Ritmo verbal" value={`${ritmoMedio} ppm`} helper="Velocidad media de la intervencion." />
                    <MetricCard label="Disfluencias" value={`${disfluencias}`} helper="Muletillas o rupturas de fluidez detectadas." />
                    <MetricCard label="Presencia visual" value={confianzaVisual} helper="Grado de consistencia en la evidencia visual." />
                  </div>

                  {informe.datosDuros?.ritmoGrafica?.length ? (
                    <div className="chart-card">
                      <div className="chart-head">
                        <h3>Ritmo a lo largo de la intervencion</h3>
                        <span>Palabras por minuto</span>
                      </div>
                      <svg viewBox="0 0 600 180" style={{ width: '100%', height: '180px', overflow: 'visible' }}>
                        <rect x="0" y="24" width="600" height="116" fill="#F7F3EB" rx="18" />
                        {(() => {
                          const data = informe.datosDuros.ritmoGrafica;
                          const points = data.map((d: any, idx: number) => ({
                            x: (idx / (data.length - 1 || 1)) * 560 + 20,
                            y: 128 - ((Math.min(240, Math.max(60, d.wpm)) - 60) / 180) * 88,
                          }));

                          return (
                            <>
                              <path d={generateSmoothPath(points)} fill="none" stroke="#8E3631" strokeWidth="4" strokeLinecap="round" />
                              {points.map((point: { x: number; y: number }, idx: number) => (
                                <circle key={idx} cx={point.x} cy={point.y} r="3.5" fill="#E7C257" />
                              ))}
                            </>
                          );
                        })()}
                      </svg>
                    </div>
                  ) : null}
                </div>
              </article>

              <div className="audit-grid">
                <article className="audit-panel">
                  <h3>Diagnostico retorico</h3>
                  <div className="observation-list">
                    <ObservationCard
                      title="Apertura"
                      observation={informe.auditoriaRetorica?.apertura?.evidencia || 'Sin evidencia suficiente.'}
                      interpretation={informe.auditoriaRetorica?.apertura?.evaluacionCritica || 'Sin lectura disponible.'}
                      confidence="Alta"
                    />
                    <ObservationCard
                      title="Argumentacion"
                      observation={informe.auditoriaRetorica?.argumentacion?.evidencia || 'Sin evidencia suficiente.'}
                      interpretation={informe.auditoriaRetorica?.argumentacion?.evaluacionCritica || 'Sin lectura disponible.'}
                      confidence="Media"
                    />
                    <ObservationCard
                      title="Cierre"
                      observation={informe.auditoriaRetorica?.cierre?.evidencia || 'Sin evidencia suficiente.'}
                      interpretation={informe.auditoriaRetorica?.cierre?.evaluacionCritica || 'Sin lectura disponible.'}
                      confidence="Alta"
                    />
                  </div>
                </article>

                <article className="audit-panel">
                  <h3>Diagnostico visual</h3>
                  <div className="observation-list">
                    <ObservationCard
                      title="Eje de mirada"
                      observation={informe.auditoriaVisual?.ejeMirada?.observacion || 'Sin evidencia suficiente.'}
                      interpretation={informe.auditoriaVisual?.ejeMirada?.interpretacion || 'Sin lectura disponible.'}
                      confidence={informe.auditoriaVisual?.ejeMirada?.confianza || 'No evaluada'}
                    />
                    <ObservationCard
                      title="Postura y gestualidad"
                      observation={informe.auditoriaVisual?.posturaGestualidad?.observacion || 'Sin evidencia suficiente.'}
                      interpretation={informe.auditoriaVisual?.posturaGestualidad?.interpretacion || 'Sin lectura disponible.'}
                      confidence={informe.auditoriaVisual?.posturaGestualidad?.confianza || 'No evaluada'}
                    />
                  </div>
                </article>
              </div>

              {informe.eventosDestacados?.length ? (
                <article className="timeline-card">
                  <h3 className="section-title">Momentos clave</h3>
                  <div className="timeline-list">
                    {informe.eventosDestacados.map((item: any, idx: number) => (
                      <div key={idx} className="timeline-item">
                        <div className="timeline-time">{item.tiempoAproximado}</div>
                        <div className="timeline-copy">
                          <blockquote>&quot;{item.evidenciaLiteral}&quot;</blockquote>
                          <p>{item.diagnostico}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
