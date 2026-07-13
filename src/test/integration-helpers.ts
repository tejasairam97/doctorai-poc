import { prisma } from "@/lib/prisma";

export function uniqueIntegrationId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function cleanupIntegrationData(input: {
  doctorEmails: string[];
  patientEmails: string[];
}) {
  const doctors = await prisma.doctorAccount.findMany({
    where: { email: { in: input.doctorEmails } },
    select: { id: true }
  });
  const patients = await prisma.patient.findMany({
    where: { email: { in: input.patientEmails } },
    select: { id: true }
  });
  const doctorIds = doctors.map((doctor) => doctor.id);
  const patientIds = patients.map((patient) => patient.id);
  const visits = await prisma.visit.findMany({
    where: {
      OR: [{ doctorId: { in: doctorIds } }, { patientId: { in: patientIds } }]
    },
    select: { id: true }
  });
  const visitIds = visits.map((visit) => visit.id);

  await prisma.patientSummaryLink.deleteMany({
    where: { OR: [{ createdByDoctorId: { in: doctorIds } }, { visitId: { in: visitIds } }] }
  });
  await prisma.emailDeliveryLog.deleteMany({
    where: { OR: [{ doctorId: { in: doctorIds } }, { visitId: { in: visitIds } }] }
  });
  await prisma.usageEvent.deleteMany({
    where: { OR: [{ doctorId: { in: doctorIds } }, { visitId: { in: visitIds } }] }
  });
  await prisma.patientProgressSummary.deleteMany({
    where: { OR: [{ doctorId: { in: doctorIds } }, { patientId: { in: patientIds } }] }
  });
  await prisma.visit.deleteMany({ where: { id: { in: visitIds } } });
  await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
  await prisma.doctorAccount.deleteMany({ where: { id: { in: doctorIds } } });
}
