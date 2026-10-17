"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck,
  FileText,
  Mic,
  ShieldAlert,
  Stethoscope,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBirthDateAndAge } from "@/lib/patient-formatters";
import type { ConsultationDetail } from "@/server/consultations";
import type { PatientOverview } from "@/server/patients";
import { AudioAnamnesisView } from "./audio-anamnesis-view";
import {
  AnamnesisStatusBadge,
  ConsultationStatusBadge,
} from "./consultation-badges";
import { formatDateTime, formatScheduledAt } from "./format-date";

export interface ConsultationDetailViewProps {
  orgSlug: string;
  consultation: ConsultationDetail;
  patientOverview: PatientOverview | null;
  activeTab?: string;
}

export function ConsultationDetailView({
  orgSlug,
  consultation,
  patientOverview,
  activeTab = "overview",
}: ConsultationDetailViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Validate active tab
  const validTabs = ["overview", "anamnesis", "review"];
  const currentTabFromUrl = searchParams.get("tab");
  const currentTab = validTabs.includes(currentTabFromUrl || "")
    ? (currentTabFromUrl as string)
    : validTabs.includes(activeTab)
      ? activeTab
      : "overview";

  const handleTabChange = (nextTab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", nextTab);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const patientName =
    consultation.patient?.fullName ||
    patientOverview?.patient.fullName ||
    "Paciente";
  const patientBirthDate =
    patientOverview?.patient.birthDate || consultation.patient?.birthDate;
  const { ageText, birthDateFormatted } =
    formatBirthDateAndAge(patientBirthDate);

  const allergies: string[] =
    patientOverview?.allergies ||
    patientOverview?.clinicalSummary?.allergies ||
    consultation.patient?.allergies ||
    [];

  const clinicalAlerts: string[] =
    patientOverview?.clinicalAlerts ||
    patientOverview?.clinicalSummary?.clinicalAlerts ||
    consultation.patient?.clinicalAlerts ||
    [];

  const insurance =
    patientOverview?.patient.healthInsurance ||
    patientOverview?.activeInsurance?.name ||
    patientOverview?.healthInsurance ||
    consultation.patient?.healthInsurance ||
    "Particular";

  const insuranceNumber =
    patientOverview?.patient.insuranceNumber ||
    patientOverview?.activeInsurance?.number ||
    patientOverview?.insuranceNumber ||
    consultation.patient?.insuranceNumber;

  const professionalName =
    consultation.professional?.fullName || "Profissional Clínico";
  const professionalMeta = [
    consultation.professional?.professionalTitle,
    consultation.professional?.registrationNumber,
  ]
    .filter(Boolean)
    .join(" • ");

  const isDraft = consultation.anamnesisStatus === "DRAFT";
  const shortcutText = isDraft ? "Continuar gravação" : "Iniciar gravação";

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Top Bar: Back button */}
      <div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 mb-3 text-muted-foreground hover:text-foreground"
        >
          <Link href={`/app/${encodeURIComponent(orgSlug)}/consultations`}>
            <ArrowLeft className="mr-1.5 size-4" />
            Voltar para atendimentos
          </Link>
        </Button>

        {/* Consultation Header */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Stethoscope className="size-6" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/app/${encodeURIComponent(orgSlug)}/patients/${consultation.patientId}`}
                  className="font-heading text-2xl font-semibold tracking-tight text-foreground transition-colors hover:text-primary hover:underline"
                >
                  {patientName}
                </Link>
                <div className="flex items-center gap-1.5">
                  <ConsultationStatusBadge status={consultation.status} />
                  <AnamnesisStatusBadge status={consultation.anamnesisStatus} />
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Calendar className="size-3.5" />
                <span>
                  {formatScheduledAt(
                    consultation.scheduledAt,
                    consultation.localScheduledAt,
                  )}
                </span>
                <span className="text-border">•</span>
                <span>{professionalName}</span>
              </p>
            </div>
          </div>

          {/* Shortcut action button */}
          <div className="flex items-center gap-2">
            <Button
              asChild
              className="gap-2 shadow-sm"
              variant={isDraft ? "secondary" : "default"}
            >
              <Link
                href={`/app/${encodeURIComponent(orgSlug)}/consultations/${consultation.id}?tab=anamnesis`}
                onClick={(e) => {
                  e.preventDefault();
                  handleTabChange("anamnesis");
                }}
              >
                <Mic className="size-4" />
                <span>{shortcutText}</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Persistent Tabs Navigation */}
      <Tabs
        value={currentTab}
        onValueChange={handleTabChange}
        className="w-full space-y-6"
      >
        <TabsList className="bg-muted p-1">
          <TabsTrigger value="overview" className="gap-2">
            <Activity className="size-4" />
            <span>Resumo</span>
          </TabsTrigger>
          <TabsTrigger value="anamnesis" className="gap-2">
            <Mic className="size-4" />
            <span>Gravação</span>
          </TabsTrigger>
          <TabsTrigger value="review" className="gap-2">
            <FileText className="size-4" />
            <span>Revisão</span>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Resumo (overview) */}
        <TabsContent value="overview" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* 1. Contextual Appointment Card */}
            <Card className="border border-border shadow-xs">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Clock className="size-4 text-primary" />
                    Contexto do Atendimento
                  </CardTitle>
                </div>
                <CardDescription>
                  Dados agendados e queixa principal relatada
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Queixa Principal
                  </span>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {consultation.chiefComplaint ||
                      "Nenhuma queixa principal registrada no início do atendimento."}
                  </p>
                </div>

                <div className="border-t border-border/60 pt-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Horário Agendado
                  </span>
                  <p className="mt-0.5 text-sm text-foreground">
                    {formatScheduledAt(
                      consultation.scheduledAt,
                      consultation.localScheduledAt,
                    )}
                  </p>
                </div>

                <div className="border-t border-border/60 pt-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Profissional Responsável
                  </span>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {professionalName}
                  </p>
                  {professionalMeta && (
                    <p className="text-xs text-muted-foreground">
                      {professionalMeta}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 2. Patient Summary Card */}
            <Card className="border border-border shadow-xs">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <User className="size-4 text-primary" />
                    Resumo do Paciente
                  </CardTitle>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Link
                      href={`/app/${encodeURIComponent(orgSlug)}/patients/${consultation.patientId}`}
                    >
                      Ver cadastro
                      <ExternalLink className="ml-1 size-3" />
                    </Link>
                  </Button>
                </div>
                <CardDescription>
                  Idade, plano de saúde e alertas clínicos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Idade e Nascimento
                  </span>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {ageText}{" "}
                    {birthDateFormatted !== "—" && (
                      <span className="font-normal text-muted-foreground">
                        ({birthDateFormatted})
                      </span>
                    )}
                  </p>
                </div>

                <div className="border-t border-border/60 pt-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Convênio / Plano
                  </span>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {insurance}
                    {insuranceNumber && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (Nº {insuranceNumber})
                      </span>
                    )}
                  </p>
                </div>

                <div className="border-t border-border/60 pt-3 space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Alergias
                  </span>
                  {allergies.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {allergies.map((allergy) => (
                        <Badge
                          key={allergy}
                          variant="outline"
                          className="border-destructive/30 bg-destructive/10 text-destructive text-xs"
                        >
                          <AlertTriangle className="mr-1 size-3" />
                          {allergy}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma alergia registrada
                    </p>
                  )}
                </div>

                <div className="border-t border-border/60 pt-3 space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Alertas Clínicos
                  </span>
                  {clinicalAlerts.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {clinicalAlerts.map((alert) => (
                        <Badge
                          key={alert}
                          variant="outline"
                          className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs"
                        >
                          <ShieldAlert className="mr-1 size-3" />
                          {alert}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Nenhum alerta clínico registrado
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 3. Status & Timeline Card */}
            <Card className="border border-border shadow-xs">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Activity className="size-4 text-primary" />
                  Status e Linha do Tempo
                </CardTitle>
                <CardDescription>
                  Marcos do atendimento e da anamnese
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <ConsultationStatusBadge status={consultation.status} />
                  <AnamnesisStatusBadge status={consultation.anamnesisStatus} />
                </div>

                <div className="border-t border-border/60 pt-3 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-xs text-muted-foreground">
                      Início da Consulta
                    </span>
                    <span className="font-medium text-foreground">
                      {formatDateTime(consultation.startedAt)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-xs text-muted-foreground">
                      Término da Consulta
                    </span>
                    <span className="font-medium text-foreground">
                      {consultation.completedAt
                        ? formatDateTime(consultation.completedAt)
                        : consultation.status === "IN_PROGRESS"
                          ? "Em andamento"
                          : "Não finalizado"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-xs text-muted-foreground">
                      Última Modificação da Anamnese
                    </span>
                    <span className="font-medium text-foreground">
                      {formatDateTime(
                        consultation.draftSavedAt || consultation.updatedAt,
                      )}
                    </span>
                  </div>
                </div>

                {consultation.anamnesisStatus === "APPROVED" && (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <div className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      Anamnese assinada digitalmente
                    </div>
                    {consultation.signedBy && (
                      <p className="mt-1 text-muted-foreground">
                        Por: {consultation.signedBy}
                      </p>
                    )}
                    {consultation.approvedAt && (
                      <p className="text-muted-foreground">
                        Em: {formatDateTime(consultation.approvedAt)}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Gravação (anamnesis) */}
        <TabsContent value="anamnesis" className="space-y-6 outline-none">
          <AudioAnamnesisView
            orgSlug={orgSlug}
            consultation={consultation}
            onSuccess={() => handleTabChange("review")}
          />
        </TabsContent>

        {/* Tab 3: Revisão (review) */}
        <TabsContent value="review" className="space-y-6 outline-none">
          <Card className="border border-border shadow-xs">
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                    <FileCheck className="size-5 text-primary" />
                    Revisão da Anamnese e Assinatura Médica
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Confira as informações clínicas estruturadas antes de
                    assinar o prontuário do atendimento.
                  </CardDescription>
                </div>
                <div>
                  <AnamnesisStatusBadge status={consultation.anamnesisStatus} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {consultation.anamnesisStatus === "APPROVED" ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />
                    <div className="space-y-1">
                      <h4 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
                        Anamnese Aprovada e Assinada
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        Este documento foi finalizado e homologado com carimbo
                        digital imutável.
                      </p>
                      <div className="mt-4 grid grid-cols-1 gap-2 pt-2 text-xs text-muted-foreground sm:grid-cols-2">
                        <div>
                          <span className="font-medium text-foreground">
                            Assinado por:
                          </span>{" "}
                          {consultation.signedBy || professionalName}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">
                            Data de aprovação:
                          </span>{" "}
                          {formatDateTime(consultation.approvedAt)}
                        </div>
                        {consultation.snapshotHash && (
                          <div className="sm:col-span-2">
                            <span className="font-medium text-foreground">
                              Hash de integridade:
                            </span>{" "}
                            <span className="font-mono text-[11px]">
                              {consultation.snapshotHash}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-muted/20 p-5">
                    <div className="flex items-start gap-3">
                      <FileText className="size-5 text-primary" />
                      <div className="flex-1 space-y-3">
                        <div>
                          <h4 className="text-sm font-semibold text-foreground">
                            Queixa Principal
                          </h4>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {consultation.chiefComplaint ||
                              "Pendente de preenchimento ou transcrição."}
                          </p>
                        </div>

                        <div className="border-t border-border/60 pt-3">
                          <h4 className="text-sm font-semibold text-foreground">
                            Notas Clínicas e Evolução
                          </h4>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {consultation.clinicalNotes ||
                              "Nenhuma nota clínica inserida até o momento."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Pronto para finalizar o prontuário?
                      </p>
                      <p className="text-xs text-muted-foreground">
                        A assinatura médica fecha as alterações e gera o
                        histórico definitivo.
                      </p>
                    </div>
                    <Button variant="outline" className="gap-2">
                      <FileCheck className="size-4" />
                      Revisar e Assinar Anamnese
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
