// Datos QUEMADOS para la demo del scoring
export type Dossier = {
  ruc: string;
  financiera: {
    activosCorrientes: number;
    pasivosCorrientes: number;
    pasivosTotales: number;
    activosTotales: number;
    utilidadNeta: number;
    ventas: number;
    costoVentas: number;
    inventarioPromedio: number;
    flujoCajaOperativo: number; // EFE
  };
  digital: {
    estrellas: number;   // 0..5
    reseñas: number;     // conteo
    fans: number;        // conteo
    sentimiento: number; // -1..1
  };
  comercialLegal: {
    ivaPorPagarMensual: number[]; // serie mensual últimos 12
    procesosPenales: number;
    procesosLaborales: number;
    fechaInicioActividades: string; // ISO
  };
  decision: {
    ingresosMensuales: number;
    egresosMensuales: number;
    cuotasVigentes: number;
    tasaMensual: number; // r
    nMeses: number;      // n
    pmtPropuesta?: number; // opcional para DSR
  };
};

export const MOCK_DOSSIER: Dossier = {
  ruc: "1790012345001",
  financiera: {
    activosCorrientes: 120000,
    pasivosCorrientes: 60000,
    pasivosTotales: 180000,
    activosTotales: 350000,
    utilidadNeta: 32000,
    ventas: 280000,
    costoVentas: 170000,
    inventarioPromedio: 40000,
    flujoCajaOperativo: 21000
  },
  digital: {
    estrellas: 4.3,
    reseñas: 156,
    fans: 2450,
    sentimiento: 0.35
  },
  comercialLegal: {
    ivaPorPagarMensual: [1200,1150,1180,1210,1190,1205,1202,1198,1201,1203,1204,1206],
    procesosPenales: 0,
    procesosLaborales: 1,
    fechaInicioActividades: "2016-05-10"
  },
  decision: {
    ingresosMensuales: 42000,
    egresosMensuales: 28000,
    cuotasVigentes: 3500,
    tasaMensual: 0.025,
    nMeses: 24,
    pmtPropuesta: 1200
  }
};
