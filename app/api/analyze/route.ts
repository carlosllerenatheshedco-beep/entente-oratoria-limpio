import { NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// VOLVEMOS A LA URL SEGURA, SIN PROCESS.ENV QUE LA ROMPA
const supabaseUrl = 'https://cezgntxyurzgctwwvmib.supabase.co';
const supabaseKey = 'sb_publishable_bd2aLD19H3XlqK_yZ5p-rQ_gGP6mXtc';

export async function POST(req: Request) {
  let tempAudioPath = '';
  let tempDir = '';
  let fileNameGlobal = '';

  try {
    const body = await req.json();
    const { 
      fileName, 
      language, 
      frames, 
      contexto = "Comité de dirección o entorno corporativo", 
      audiencia = "C-Level o *stakeholders* clave", 
      objetivo = "Persuadir e informar con impacto"
    } = body;
    
    fileNameGlobal = fileName;

    if (!fileName) {
      return NextResponse.json({ error: 'Faltan datos de análisis.' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('audios-oratoria')
      .download(fileName);

    if (downloadError || !fileData) {
      throw new Error(`Error en Supabase: ${downloadError?.message}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    tempDir = fs.mkdtempSync(path.join(osTmpDir(), 'oratoria-'));
    tempAudioPath = path.join(tempDir, fileName);
    fs.writeFileSync(tempAudioPath, buffer);

    const fileForWhisper = await toFile(buffer, fileName, { type: 'audio/wav' });
    
    const transcription: any = await openai.audio.transcriptions.create({
      file: fileForWhisper,
      model: 'whisper-1',
      language: language === 'es-MX' ? 'es' : 'es', 
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
    });

    const words = transcription.words || [];
    const textoLimpio = (transcription.text || '').trim();
    
    if (words.length < 4 || textoLimpio.length < 15 || textoLimpio.toLowerCase().includes('amara.org')) {
      try {
        if (fileNameGlobal) await supabase.storage.from('audios-oratoria').remove([fileNameGlobal]);
        if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
      return NextResponse.json({ error: 'El vídeo no contiene suficiente voz.' }, { status: 400 });
    }

    const duracionMinutos = (words[words.length - 1].end || 1) / 60;
    const wpmGlobal = Math.round(words.length / duracionMinutos) || 0;
    
    const ritmoGrafica: { timeLabel: string; wpm: number }[] = [];
    let muletillasCalculadas = 0;
    const muletillasRealesEncontradas: string[] = [];
    const muletillasRegex = /\b(eh|em|mmm|estee|bueno|digamos|o sea)\b/gi;
    
    const windowSize = duracionMinutos * 60 < 15 ? Math.max(3, (duracionMinutos * 60) / 3) : 8; 
    const step = Math.max(0.5, (duracionMinutos * 60) / 15); 
    for (let t = 0; t <= duracionMinutos * 60; t += step) {
      const windowStart = Math.max(0, t - windowSize / 2);
      const windowEnd = Math.min(duracionMinutos * 60, t + windowSize / 2);
      const effectiveWindow = windowEnd - windowStart;
      if (effectiveWindow > 0.5) {
        const chunkWords = words.filter((w: any) => w.start >= windowStart && w.start < windowEnd);
        const chunkText = chunkWords.map((w:any) => w.word).join(' ');
        
        const matches = chunkText.match(muletillasRegex);
        if (matches) {
          matches.forEach((m: string) => {
            const lowerM = m.toLowerCase();
            muletillasCalculadas++;
            if (!muletillasRealesEncontradas.includes(lowerM)) muletillasRealesEncontradas.push(lowerM);
          });
        }

        const minutes = effectiveWindow / 60;
        let wpm = Math.round(chunkWords.length / minutes);
        wpm = Math.min(240, Math.max(40, isNaN(wpm) ? 0 : wpm));
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60);
        const timeLabel = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        if (!ritmoGrafica.some(p => p.timeLabel === timeLabel)) ritmoGrafica.push({ timeLabel, wpm });
      }
    }

    const userContent: any[] = [
      { 
        type: "text", 
        text: `### CONTEXTO DE LA INTERVENCIÓN ###
        - Contexto: ${contexto}
        - Audiencia: ${audiencia}
        - Objetivo comunicativo: ${objetivo}
        
        ### DATOS DUROS EXTRAÍDOS POR CÓDIGO ###
        - Velocidad media: ${wpmGlobal} palabras por minuto.
        - Disfluencias detectadas (eh, mmm, etc.): ${muletillasCalculadas} (${muletillasRealesEncontradas.join(', ')}).
        - Transcripción literal: "${transcription.text}".
        
        Analiza la adecuación del discurso al contexto y correlaciona el texto con la secuencia visual proporcionada.` 
      }
    ];
    frames.forEach((base64Img: string) => {
      userContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Img}`, detail: "low" } });
    });

    const analysis = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Eres un 'Executive Speech Coach' de élite. Tu prioridad no es encontrar errores sino producir el diagnóstico más preciso y accionable posible.

          PRINCIPIO FUNDAMENTAL DE EVIDENCIA:
          1. EVIDENCIA: Qué has observado literalmente (texto o imagen).
          2. INTERPRETACIÓN: Qué podría significar comunicativamente. No conviertes una hipótesis en un hecho.
          3. IMPACTO: Por qué importa.
          4. CONFIANZA: Alta, media o baja basándote en la calidad de la evidencia.
          - La ausencia de un defecto es información válida. Sé positivo cuando haya evidencia.
          - Si una dimensión no puede evaluarse con seguridad, devuelve null o "no_evaluable". No inventes datos.

          DIRECTRICES DE AUDITORÍA:
          - VISUAL: Distingue entre mirar a la lente, mantener la cabeza estable (posible teleprompter) o inclinar el eje hacia abajo (lectura de notas). No evalúes parpadeos ni microexpresiones desde fotogramas discontinuos. Solo elementos sostenidos (postura, eje de mirada).
          - RETÓRICA: Evalúa si la última idea significativa funciona, no penalices fórmulas de cortesía protocolaria como "gracias" si la tesis ya se cerró bien. No fuerces reglas retóricas si el mensaje es claro.
          - MULETILLAS Y PROSODIA: Usa los datos duros proporcionados en el prompt. Distingue entre disfluencias ("eh", "mmm") y marcadores semánticos.

          Sigue estrictamente el esquema JSON proporcionado.`
        },
        { role: 'user', content: userContent }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "auditoria_oratoria_ejecutiva",
          strict: true,
          schema: {
            type: "object",
            properties: {
              top3PalancasCrecimiento: {
                type: "array",
                description: "Los 3 comportamientos que más impacto producirían si se corrigieran o potenciaran.",
                items: {
                  type: "object",
                  properties: {
                    comportamiento: { type: "string" },
                    evidenciaObservada: { type: "string" },
                    impacto: { type: "string", description: "Alto, Medio o Bajo" },
                    recomendacion: { type: "string" }
                  },
                  required: ["comportamiento", "evidenciaObservada", "impacto", "recomendacion"],
                  additionalProperties: false
                }
              },
              auditoriaVisual: {
                type: "object",
                properties: {
                  ejeMirada: {
                    type: "object",
                    properties: {
                      observacion: { type: "string", description: "Hecho visible: ej. 'En la mayoría de frames la cabeza está inclinada hacia abajo'." },
                      interpretacion: { type: "string", description: "Hipótesis: ej. 'Compatible con lectura de notas en la mesa'." },
                      confianza: { type: "string", description: "Alta, Media, Baja" }
                    },
                    required: ["observacion", "interpretacion", "confianza"],
                    additionalProperties: false
                  },
                  posturaGestualidad: {
                    type: "object",
                    properties: {
                      observacion: { type: "string" },
                      interpretacion: { type: "string" },
                      confianza: { type: "string" }
                    },
                    required: ["observacion", "interpretacion", "confianza"],
                    additionalProperties: false
                  }
                },
                required: ["ejeMirada", "posturaGestualidad"],
                additionalProperties: false
              },
              auditoriaRetorica: {
                type: "object",
                properties: {
                  apertura: {
                    type: "object",
                    properties: {
                      evidencia: { type: "string" },
                      evaluacionCritica: { type: "string" }
                    },
                    required: ["evidencia", "evaluacionCritica"],
                    additionalProperties: false
                  },
                  argumentacion: {
                    type: "object",
                    properties: {
                      evidencia: { type: "string" },
                      evaluacionCritica: { type: "string" }
                    },
                    required: ["evidencia", "evaluacionCritica"],
                    additionalProperties: false
                  },
                  cierre: {
                    type: "object",
                    properties: {
                      evidencia: { type: "string", description: "La última idea comunicativa significativa antes de las cortesías." },
                      evaluacionCritica: { type: "string" }
                    },
                    required: ["evidencia", "evaluacionCritica"],
                    additionalProperties: false
                  }
                },
                required: ["apertura", "argumentacion", "cierre"],
                additionalProperties: false
              },
              rubricaPersuasion: {
                type: "object",
                description: "Evaluación sobre 10 basada en claridad, relevancia, construcción y movilización.",
                properties: {
                  claridadTesis: { type: "number", description: "De 0 a 2" },
                  relevanciaAudiencia: { type: "number", description: "De 0 a 2" },
                  construccionRetorica: { type: "number", description: "De 0 a 2" },
                  cierreMovilizacion: { type: "number", description: "De 0 a 2" },
                  adecuacionContexto: { type: "number", description: "De 0 a 2" },
                  total: { type: "number", description: "Suma total sobre 10" },
                  justificacionGlobal: { type: "string" }
                },
                required: ["claridadTesis", "relevanciaAudiencia", "construccionRetorica", "cierreMovilizacion", "adecuacionContexto", "total", "justificacionGlobal"],
                additionalProperties: false
              },
              eventosDestacados: {
                type: "array",
                description: "Línea temporal de momentos clave (aciertos o errores). No inventar huecos si no hay evidencia.",
                items: {
                  type: "object",
                  properties: {
                    tiempoAproximado: { type: "string", description: "Ej. '0:45' o 'Final del discurso'" },
                    evidenciaLiteral: { type: "string" },
                    diagnostico: { type: "string" }
                  },
                  required: ["tiempoAproximado", "evidenciaLiteral", "diagnostico"],
                  additionalProperties: false
                }
              }
            },
            required: ["top3PalancasCrecimiento", "auditoriaVisual", "auditoriaRetorica", "rubricaPersuasion", "eventosDestacados"],
            additionalProperties: false
          }
        }
      },
      temperature: 0.1
    });

    const result = JSON.parse(analysis.choices[0].message.content || '{}');
    
    result.datosDuros = {
      ritmoPalabrasPorMinuto: wpmGlobal,
      ritmoGrafica: ritmoGrafica,
      muletillasDetectadas: muletillasCalculadas,
      muletillasLista: muletillasRealesEncontradas
    };

    try { if (fileNameGlobal) await supabase.storage.from('audios-oratoria').remove([fileNameGlobal]); } catch {}
    try { if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    
    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error("Error IA:", err);
    return NextResponse.json({ error: `Fallo: ${err.message}` }, { status: 500 });
  }
}

function osTmpDir() { return require('os').tmpdir(); }