const { createHash } = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function hashPassword(password) {
  return createHash("sha256").update(password).digest("hex");
}

async function main() {
  const doctor = await prisma.doctorAccount.upsert({
    where: { email: "demo@doctorai.local" },
    update: {},
    create: {
      name: "Dr. Demo",
      email: "demo@doctorai.local",
      passwordHash: hashPassword("password123")
    }
  });

  const existingVisit = await prisma.visit.findFirst({
    where: { doctorId: doctor.id }
  });

  if (!existingVisit) {
    const patient = await prisma.patient.create({
      data: {
        name: "Avery Patel",
        age: 42,
        email: "avery@example.com",
        phone: "555-0134"
      }
    });

    const visit = await prisma.visit.create({
      data: {
        doctorId: doctor.id,
        patientId: patient.id,
        consentStatus: "UNKNOWN",
        inputModeRequested: "DOCTOR_SELF_SUMMARY",
        inputModeActual: "DOCTOR_SELF_SUMMARY",
        status: "DRAFT"
      }
    });

    await prisma.usageEvent.create({
      data: {
        doctorId: doctor.id,
        visitId: visit.id,
        type: "SEED_DRAFT_VISIT_CREATED",
        metadata: JSON.stringify({ source: "prisma/seed.js" })
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
