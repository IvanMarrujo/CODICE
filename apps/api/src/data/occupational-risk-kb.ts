// ============================================================
// CÓDICE Radar · Knowledge base de riesgo ocupacional
// Estático (Opción A) — normas mexicanas + perfiles de riesgo por
// depto. Sirve como semilla de `department_risk_profiles` y como
// contexto de referencia para el digest semanal (ver jobs/radarWeekly.ts).
// No sustituye asesoría legal/médica profesional.
// ============================================================

export interface OccupationalNorma {
  clave: string
  titulo: string
  url: string
  aplicaA: string[]
  requisitos: string[]
}

export interface DepartmentRiskKB {
  riesgosAltos: string[]
  enfermedadesComunes: string[]
  examenRequerido: 'anual' | 'semestral' | 'cuatrimestral' | 'trimestral'
  condicionesIncompatibles: string[]
}

export const OCCUPATIONAL_RISK_KB: {
  normas: OccupationalNorma[]
  riesgosPorDepartamento: Record<string, DepartmentRiskKB>
} = {
  normas: [
    {
      clave: 'NOM-030-STPS-2009',
      titulo: 'Servicios preventivos de seguridad y salud en el trabajo',
      url: 'https://www.dof.gob.mx/normasOficiales/3977/stps2/stps2.htm',
      aplicaA: ['manufactura', 'almacen', 'logistica', 'alimentos'],
      requisitos: ['examen_medico_ingreso', 'examen_periodico', 'historial_accidentes'],
    },
    {
      clave: 'NOM-035-STPS-2018',
      titulo: 'Factores de riesgo psicosocial en el trabajo',
      url: 'https://www.dof.gob.mx/nota_detalle.php?codigo=5541828',
      aplicaA: ['todos'],
      requisitos: ['evaluacion_clima_laboral', 'identificacion_trabajadores_expuestos'],
    },
    {
      clave: 'NOM-019-STPS-2011',
      titulo: 'Comisiones de seguridad e higiene',
      url: 'https://www.dof.gob.mx/normasOficiales/4453/stps230411/stps230411.htm',
      aplicaA: ['manufactura', 'empaque', 'almacen'],
      requisitos: ['comision_seguridad_higiene', 'actas_verificacion'],
    },
  ],
  riesgosPorDepartamento: {
    'Producción': {
      riesgosAltos: ['lesiones_maquinaria', 'ruido_industrial', 'temperaturas_extremas'],
      enfermedadesComunes: ['hipoacusia', 'lesiones_musculoesqueleticas'],
      examenRequerido: 'semestral',
      condicionesIncompatibles: ['epilepsia', 'problemas_auditivos_severos'],
    },
    'Almacén y Logística': {
      riesgosAltos: ['lesiones_lumbares', 'golpes_montacargas', 'caidas'],
      enfermedadesComunes: ['hernias', 'lumbalgia_cronica'],
      examenRequerido: 'semestral',
      condicionesIncompatibles: ['hernias_sin_operar', 'problemas_lumbares_severos'],
    },
    'Empaque': {
      riesgosAltos: ['movimientos_repetitivos', 'posturas_forzadas'],
      enfermedadesComunes: ['sindrome_tunel_carpiano', 'tendinitis'],
      examenRequerido: 'anual',
      condicionesIncompatibles: ['artritis_severa'],
    },
    'Calidad e Inocuidad': {
      riesgosAltos: ['exposicion_quimicos', 'contacto_alergenos'],
      enfermedadesComunes: ['dermatitis_contacto', 'asma_ocupacional'],
      examenRequerido: 'semestral',
      condicionesIncompatibles: ['alergias_severas_quimicos'],
    },
    'Mantenimiento': {
      riesgosAltos: ['trabajos_altura', 'riesgo_electrico', 'quemaduras'],
      enfermedadesComunes: ['lesiones_trauma', 'problemas_vision'],
      examenRequerido: 'semestral',
      condicionesIncompatibles: ['acrofobia_severa', 'epilepsia'],
    },
    'Recursos Humanos': {
      riesgosAltos: ['estres_laboral', 'sedentarismo'],
      enfermedadesComunes: ['estres_cronico', 'problemas_posturales'],
      examenRequerido: 'anual',
      condicionesIncompatibles: [],
    },
  },
}

// perfil_optimo.examenRequerido viene de department_risk_profiles (JSONB editable
// a mano en la DB) — admite más frecuencias que la unión estricta de la KB
// estática (DepartmentRiskKB['examenRequerido']), de ahí el string suelto acá.
export function examFrequencyMonths(freq: string | null | undefined): number {
  switch (freq?.toLowerCase()) {
    case 'mensual':       return 1
    case 'bimestral':     return 2
    case 'trimestral':    return 3
    case 'cuatrimestral': return 4
    case 'semestral':     return 6
    case 'anual':         return 12
    default:              return 12
  }
}

// Deptos del tenant único (ORG.deptos en el shell admin) que no tienen
// perfil propio en la KB comparten un perfil genérico — mejor que dejarlos
// sin fila en department_risk_profiles.
export const GENERIC_DEPARTMENT_PROFILE: DepartmentRiskKB = {
  riesgosAltos: [],
  enfermedadesComunes: [],
  examenRequerido: 'anual',
  condicionesIncompatibles: [],
}
