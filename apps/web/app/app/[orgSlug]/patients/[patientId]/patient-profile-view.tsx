"use client";

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  FileTextIcon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  UserIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
import { isClinicalRole } from "@/lib/app-navigation";
import { formatBirthDateAndAge, maskCpf } from "@/lib/patient-formatters";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import { formatPostalCode } from "@/lib/postal-code";
import { cn } from "@/lib/utils";
import type {
  PatientAttachmentsResult,
  PatientOverviewData,
  PatientTimelineResult,
} from "@/server/patients";

const VALID_TABS = ["overview", "records", "attachments"] as const;
type TabKey = (typeof VALID_TABS)[number];

interface PatientProfileViewProps {
  orgSlug: string;
  userRole: string;
  overview: PatientOverviewData;
  timeline: PatientTimelineResult;
  attachments: PatientAttachmentsResult;
  initialTab?: string;
}

export function PatientProfileView({
  orgSlug,
  userRole,
  overview,
  timeline,
  attachments,
  initialTab = "overview",
}: PatientProfileViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isClinical = isClinicalRole(userRole) && !overview.isRestricted;

  const validInitialTab: TabKey = VALID_TABS.includes(initialTab as TabKey)
    ? (initialTab as TabKey)
    : "overview";

  const [activeTab, setActiveTab] = useState<TabKey>(validInitialTab);

  const urlTab = searchParams.get("tab");
  useEffect(() => {
    if (urlTab && VALID_TABS.includes(urlTab as TabKey)) {
      setActiveTab(urlTab as TabKey);
    }
  }, [urlTab]);

  const handleTabChange = (value: string) => {
    if (!VALID_TABS.includes(value as TabKey)) return;
    const nextTab = value as TabKey;
    setActiveTab(nextTab);

    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const { ageText, birthDateFormatted } = formatBirthDateAndAge(
    overview.patient.birthDate ?? "",
  );
  const rawDigitsPhone = (overview.patient.phone ?? "").replace(/\D/g, "");
  const hasAllergies = Boolean(
    overview.allergies && overview.allergies.length > 0,
  );

  const patientInitials = overview.patient.fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div>
        <Link
          href={`/app/${orgSlug}/patients`}
          className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="mr-1.5 size-4" />
          Voltar para lista de pacientes
        </Link>
      </div>

      {/* Patient Header */}
      <section
        aria-label="Informações do paciente"
        className="rounded-xl border border-border bg-card p-6 shadow-xs"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            {/* Avatar Circle */}
            <div
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary text-xl"
              aria-hidden="true"
            >
              {patientInitials || "P"}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {overview.patient.fullName}
                </h1>
                {/* Clinical Badges or Restricted Tag in Header */}
                {isClinical ? (
                  <>
                    {overview.allergies?.map((allergy) => (
                      <Badge
                        key={allergy}
                        variant="destructive"
                        className="gap-1 font-medium"
                      >
                        <AlertTriangleIcon className="size-3" />
                        Alergia: {allergy}
                      </Badge>
                    ))}
                    {overview.comorbidities?.map((c) => (
                      <Badge key={c} variant="secondary">
                        {c}
                      </Badge>
                    ))}
                    {overview.clinicalAlerts?.map((alert) => (
                      <Badge key={alert} variant="outline">
                        {alert}
                      </Badge>
                    ))}
                  </>
                ) : (
                  <Badge
                    variant="outline"
                    className="gap-1 text-muted-foreground"
                  >
                    <LockIcon className="size-3" />
                    Informações clínicas restritas
                  </Badge>
                )}
              </div>

              {/* Meta row: Age, Birth date, Gender, CPF */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {ageText} ({birthDateFormatted})
                </span>
                <span aria-hidden="true">•</span>
                <span>{overview.patient.gender ?? "Gênero não informado"}</span>
                <span aria-hidden="true">•</span>
                <span className="font-mono text-xs sm:text-sm">
                  CPF: {maskCpf(overview.patient.cpf ?? "")}
                </span>
              </div>

              {/* Contacts row: Click-to-call phone & Mailto email */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm">
                <a
                  href={`tel:${rawDigitsPhone}`}
                  className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                  aria-label={`Ligar para ${formatPhoneWithAreaCode(overview.patient.phone ?? "")}`}
                >
                  <PhoneIcon className="size-4 shrink-0 text-primary" />
                  <span>
                    {formatPhoneWithAreaCode(overview.patient.phone ?? "")}
                  </span>
                </a>

                {overview.patient.email ? (
                  <a
                    href={`mailto:${overview.patient.email}`}
                    className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                    aria-label={`Enviar e-mail para ${overview.patient.email}`}
                  >
                    <MailIcon className="size-4 shrink-0 text-primary" />
                    <span>{overview.patient.email}</span>
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <MailIcon className="size-4 shrink-0" />
                    <span>E-mail não informado</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-0">
            <Button asChild variant="default">
              <Link
                href={`/app/${orgSlug}/appointments?sheet=new&patientId=${overview.patient.id}`}
              >
                <CalendarPlusIcon className="mr-2 size-4" />
                Agendar consulta
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link
                href={`/app/${orgSlug}/consultations?newPatientId=${overview.patient.id}`}
              >
                <StethoscopeIcon className="mr-2 size-4" />
                Novo atendimento
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Tabs navigation */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-3 sm:w-auto">
          <TabsTrigger value="overview">Resumo</TabsTrigger>
          <TabsTrigger value="records">Prontuário</TabsTrigger>
          <TabsTrigger value="attachments">Anexos</TabsTrigger>
        </TabsList>

        {/* Tab "Resumo" */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Card 1: Alertas Clínicos */}
            <Card
              className={cn(
                isClinical &&
                  hasAllergies &&
                  "border-destructive/40 bg-destructive/5",
              )}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <AlertTriangleIcon
                      className={cn(
                        "size-5",
                        hasAllergies && isClinical
                          ? "text-destructive"
                          : "text-primary",
                      )}
                    />
                    Alertas Clínicos
                  </CardTitle>
                  {isClinical && hasAllergies && (
                    <Badge variant="destructive">Atenção a Alergias</Badge>
                  )}
                </div>
                <CardDescription>
                  Alergias a medicamentos, comorbidades e condições médicas
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isClinical ? (
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3.5 text-sm text-muted-foreground">
                    <LockIcon className="size-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-foreground">
                        Acesso clínico confidencial restrito
                      </p>
                      <p className="mt-0.5 text-xs">
                        Alergias a medicamentos, comorbidades e anotações
                        médicas são acessíveis exclusivamente para profissionais
                        de saúde autorizados.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Alergias */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Alergias a medicamentos / substâncias
                      </h4>
                      {hasAllergies ? (
                        <div className="flex flex-wrap gap-1.5">
                          {overview.allergies.map((allergy) => (
                            <Badge key={allergy} variant="destructive">
                              {allergy}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Nenhuma alergia relatada.
                        </p>
                      )}
                    </div>

                    {/* Comorbidades */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Comorbidades e Condições
                      </h4>
                      {overview.comorbidities &&
                      overview.comorbidities.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {overview.comorbidities.map((item) => (
                            <Badge key={item} variant="secondary">
                              {item}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Nenhuma comorbidade relatada.
                        </p>
                      )}
                    </div>

                    {/* Alertas adicionais */}
                    {overview.clinicalAlerts &&
                      overview.clinicalAlerts.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                            Alertas Gerais
                          </h4>
                          <div className="flex flex-wrap gap-1.5">
                            {overview.clinicalAlerts.map((alert) => (
                              <Badge key={alert} variant="outline">
                                {alert}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                    {/* Notas médicas */}
                    {overview.medicalNotes && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Observações Clínicas
                        </h4>
                        <p className="rounded-md border border-border bg-muted/30 p-2.5 text-sm text-foreground">
                          {overview.medicalNotes}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Card 2: Contato e Endereço */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <UserIcon className="size-5 text-primary" />
                  Contato e Endereço
                </CardTitle>
                <CardDescription>
                  Canais de comunicação e endereço residencial
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      Telefone
                    </span>
                    <a
                      href={`tel:${rawDigitsPhone}`}
                      className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <PhoneIcon className="size-3.5" />
                      {formatPhoneWithAreaCode(overview.patient.phone ?? "")}
                    </a>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      E-mail
                    </span>
                    {overview.patient.email ? (
                      <a
                        href={`mailto:${overview.patient.email}`}
                        className="font-medium text-primary hover:underline inline-flex items-center gap-1 truncate max-w-full"
                      >
                        <MailIcon className="size-3.5 shrink-0" />
                        <span className="truncate">
                          {overview.patient.email}
                        </span>
                      </a>
                    ) : (
                      <span className="text-muted-foreground">
                        Não informado
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-border">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
                    Endereço
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        CEP
                      </span>
                      <span className="font-medium">
                        {overview.address?.postalCode
                          ? formatPostalCode(overview.address.postalCode)
                          : "Não informado"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Logradouro / Rua
                      </span>
                      <span className="font-medium truncate block">
                        {overview.address?.street ?? "Não informado"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">
                        Cidade / UF
                      </span>
                      <span className="font-medium">
                        {overview.address?.city
                          ? `${overview.address.city}${
                              overview.address.state
                                ? ` - ${overview.address.state}`
                                : ""
                            }`
                          : "Não informado"}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Card 3: Convênio / Plano de Saúde */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <ShieldCheckIcon className="size-5 text-primary" />
                  Convênio / Plano de Saúde
                </CardTitle>
                <CardDescription>
                  Dados de cobertura e identificação do plano
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3.5">
                {overview.activeInsurance ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">
                        {overview.activeInsurance.name}
                      </span>
                      <Badge variant="secondary">Convênio Ativo</Badge>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-xs text-muted-foreground block">
                          Número da Carteirinha
                        </span>
                        <span className="font-medium font-mono">
                          {overview.activeInsurance.number ?? "Não informado"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground block">
                          Validade
                        </span>
                        <span className="font-medium">
                          {overview.activeInsurance.expiration ??
                            "Não informada"}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="py-2">
                    <Badge variant="outline" className="mb-2">
                      Particular
                    </Badge>
                    <p className="text-sm text-muted-foreground">
                      Paciente particular. Nenhum convênio de saúde ativo
                      cadastrado.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card 4: Agendamentos e Consultas */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <CalendarClockIcon className="size-5 text-primary" />
                  Agendamentos e Atendimentos
                </CardTitle>
                <CardDescription>
                  Próximos horários marcados e atendimentos recentes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Upcoming */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
                    <span>Próximas Consultas</span>
                    <span className="text-xs font-normal">
                      {overview.upcomingAppointments.length} encontrada(s)
                    </span>
                  </h4>
                  {overview.upcomingAppointments.length > 0 ? (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {overview.upcomingAppointments.map((appt) => (
                        <li
                          key={appt.id}
                          className="p-2.5 flex items-center justify-between gap-2 text-sm"
                        >
                          <div>
                            <span className="font-medium block">
                              {new Intl.DateTimeFormat("pt-BR", {
                                dateStyle: "short",
                                timeStyle: "short",
                              }).format(new Date(appt.scheduledAt))}
                            </span>
                            {appt.professionalName && (
                              <span className="text-xs text-muted-foreground">
                                Profissional: {appt.professionalName}
                              </span>
                            )}
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {appt.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhum agendamento futuro encontrado.
                    </p>
                  )}
                </div>

                {/* Recent consultations */}
                <div className="pt-2 border-t border-border">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
                    <span>Atendimentos Recentes</span>
                    <span className="text-xs font-normal">
                      {overview.recentConsultations.length} encontrado(s)
                    </span>
                  </h4>
                  {overview.recentConsultations.length > 0 ? (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {overview.recentConsultations.map((consult) => (
                        <li
                          key={consult.id}
                          className="p-2.5 flex items-center justify-between gap-2 text-sm"
                        >
                          <div>
                            <span className="font-medium block">
                              {new Intl.DateTimeFormat("pt-BR", {
                                dateStyle: "short",
                              }).format(new Date(consult.scheduledAt))}
                            </span>
                            {consult.professionalName && (
                              <span className="text-xs text-muted-foreground">
                                Dr(a). {consult.professionalName}
                              </span>
                            )}
                            {consult.summary && (
                              <p className="text-xs text-muted-foreground truncate max-w-xs">
                                {consult.summary}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {consult.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhum atendimento anterior registrado.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab "Prontuário" */}
        <TabsContent value="records" className="space-y-6">
          {!isClinical || timeline.isRestricted ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <LockIcon className="size-6" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">
                  Acesso restrito ao prontuário clínico
                </h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  O prontuário e o histórico clínico deste paciente são
                  restritos a profissionais de saúde autorizados.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">
                      Histórico e Prontuário Clínico
                    </CardTitle>
                    <CardDescription>
                      Linha do tempo cronológica de atendimentos, evoluções e
                      documentos
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">
                    {timeline.data.length} registro(s)
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {timeline.data.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    Nenhum registro clínico encontrado no prontuário deste
                    paciente.
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                    {timeline.data.map((event) => (
                      <div key={event.id} className="relative">
                        <span className="absolute -left-6 top-1 flex size-4 items-center justify-center rounded-full bg-background border-2 border-primary" />
                        <div className="rounded-lg border border-border bg-card p-4 space-y-1.5 shadow-2xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                              {event.eventType === "CONSULTATION"
                                ? "Consulta"
                                : event.eventType === "DOCUMENT"
                                  ? "Documento"
                                  : event.eventType === "ATTACHMENT"
                                    ? "Anexo"
                                    : "Agendamento"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Intl.DateTimeFormat("pt-BR", {
                                dateStyle: "short",
                                timeStyle: "short",
                              }).format(new Date(event.timestamp))}
                            </span>
                          </div>
                          <p className="font-medium text-foreground text-sm">
                            {event.summary}
                          </p>
                          {event.professional && (
                            <p className="text-xs text-muted-foreground">
                              Profissional: {event.professional.name}
                              {event.professional.registrationNumber
                                ? ` (${event.professional.registrationNumber})`
                                : ""}
                            </p>
                          )}
                          <div className="pt-1 flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {event.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab "Anexos" */}
        <TabsContent value="attachments" className="space-y-6">
          {!isClinical || attachments.isRestricted ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <LockIcon className="size-6" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">
                  Acesso restrito aos anexos clínicos
                </h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Exames e documentos clínicos anexados ao paciente são
                  restritos a profissionais de saúde autorizados.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">
                      Documentos e Arquivos Anexados
                    </CardTitle>
                    <CardDescription>
                      Laudos, exames laboratoriais e arquivos digitais do
                      paciente
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">
                    {attachments.data.length} anexo(s)
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {attachments.data.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    Nenhum anexo clínico encontrado para este paciente.
                  </div>
                ) : (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {attachments.data.map((att) => (
                      <div
                        key={att.id}
                        className="p-3.5 flex items-center justify-between gap-3 text-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <FileTextIcon className="size-5 text-primary shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">
                              {att.fileName}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              {att.category && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] py-0"
                                >
                                  {att.category}
                                </Badge>
                              )}
                              <span>
                                {(att.sizeBytes / 1024).toFixed(0)} KB
                              </span>
                              <span>•</span>
                              <span>
                                {new Intl.DateTimeFormat("pt-BR", {
                                  dateStyle: "short",
                                }).format(new Date(att.createdAt))}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
