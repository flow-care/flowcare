"use client";

import { useForm, useStore } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  saveClinicAddress,
  saveClinicContact,
} from "@/app/onboarding/configure-clinic/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  type ClinicDetails,
  type ClinicDetailsInput,
  clinicAddressSchema,
  clinicContactSchema,
  formatCnpj,
} from "@/lib/clinic-details";
import { onboardingSteps } from "@/lib/onboarding-steps";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import { formatPostalCode, postalCodeDigits } from "@/lib/postal-code";

type ClinicField = {
  key: Exclude<keyof ClinicDetailsInput, "version">;
  label: string;
  placeholder: string;
  required?: boolean;
  type?: string;
};

const contactFields: ClinicField[] = [
  {
    key: "legalName",
    label: "Razão social",
    placeholder: "Razão social da clínica",
    required: true,
  },
  { key: "taxId", label: "CNPJ", placeholder: "00.000.000/0000-00" },
  {
    key: "contactEmail",
    label: "E-mail de contato",
    placeholder: "contato@clinica.com.br",
    required: true,
    type: "email",
  },
  {
    key: "contactPhone",
    label: "Telefone de contato",
    placeholder: "(85) 99999-9999",
    required: true,
    type: "tel",
  },
];

const addressFields: ClinicField[] = [
  { key: "postalCode", label: "CEP", placeholder: "00000-000", required: true },
  { key: "state", label: "Estado", placeholder: "UF", required: true },
  { key: "city", label: "Cidade", placeholder: "Cidade", required: true },
  { key: "district", label: "Bairro", placeholder: "Bairro", required: true },
  {
    key: "street",
    label: "Logradouro",
    placeholder: "Rua ou avenida",
    required: true,
  },
  {
    key: "streetNumber",
    label: "Número",
    placeholder: "Número",
    required: true,
  },
  {
    key: "addressComplement",
    label: "Complemento",
    placeholder: "Sala, bloco ou referência",
  },
];
const buttonClass = "h-[46px] rounded-lg px-5 text-base font-normal";

export function ConfigureClinicForm({
  initial,
  step,
}: {
  initial: ClinicDetails;
  step: "contact" | "address";
}) {
  const router = useRouter();
  const [conflict, setConflict] = useState(false);
  const [postalCodeEdited, setPostalCodeEdited] = useState(false);
  const [lookingUpPostalCode, setLookingUpPostalCode] = useState<string | null>(
    null,
  );
  const fields = step === "contact" ? contactFields : addressFields;
  const form = useForm({
    defaultValues: {
      version: initial.version,
      legalName: initial.legalName,
      taxId: formatCnpj(initial.taxId),
      contactEmail: initial.contactEmail,
      contactPhone: formatPhoneWithAreaCode(initial.contactPhone),
      postalCode: initial.postalCode,
      state: initial.state,
      city: initial.city,
      district: initial.district,
      street: initial.street,
      streetNumber: initial.streetNumber,
      addressComplement: initial.addressComplement,
    },
    validators: {
      onSubmit: ({ value }) => {
        const parsed = (
          step === "contact" ? clinicContactSchema : clinicAddressSchema
        ).safeParse(value);
        return parsed.success ? undefined : parsed.error.issues[0]?.message;
      },
    },
    onSubmitInvalid: ({ value }) => {
      const parsed = (
        step === "contact" ? clinicContactSchema : clinicAddressSchema
      ).safeParse(value);
      toast.error(
        parsed.success
          ? "Confira os campos informados."
          : parsed.error.issues[0]?.message,
      );
    },
    onSubmit: async ({ value }) => {
      const result = await (step === "contact"
        ? saveClinicContact(initial.slug, value)
        : saveClinicAddress(initial.slug, value));
      if (!result.ok) {
        if (result.code === "CONFLICT") setConflict(true);
        toast.error(result.message);
        return;
      }
      toast.success("Dados da clínica salvos.");
      const currentIndex = onboardingSteps.findIndex(
        (item) =>
          item.id ===
          (step === "contact" ? "CLINIC_DETAILS" : "CLINIC_ADDRESS"),
      );
      router.replace(onboardingSteps[currentIndex + 1]?.path ?? "/");
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const dirty = fields.some(
    (field) =>
      values[field.key] !==
      (field.key === "contactPhone"
        ? formatPhoneWithAreaCode(initial.contactPhone)
        : field.key === "taxId"
          ? formatCnpj(initial.taxId)
          : initial[field.key]),
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const postalCode = values.postalCode;
    if (step !== "address" || !postalCodeEdited || postalCode.length !== 8)
      return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const before = { ...form.state.values };
      try {
        const response = await fetch(`/api/postal-code/${postalCode}`, {
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          form.state.values.postalCode !== postalCode
        )
          return;
        if (!response.ok) {
          if (response.status === 404)
            toast.error(
              "CEP não encontrado. Confira o número ou preencha o endereço manualmente.",
            );
          else
            toast.error(
              "Não foi possível consultar o CEP. Preencha o endereço manualmente.",
            );
          return;
        }
        const address: {
          state: string;
          city: string;
          district: string;
          street: string;
        } = await response.json();
        if (
          controller.signal.aborted ||
          form.state.values.postalCode !== postalCode
        )
          return;
        for (const key of ["state", "city", "district", "street"] as const) {
          if (address[key] && form.state.values[key] === before[key]) {
            form.setFieldValue(key, address[key]);
          }
        }
      } catch {
        if (!controller.signal.aborted)
          toast.error(
            "Não foi possível consultar o CEP. Preencha o endereço manualmente.",
          );
      } finally {
        if (!controller.signal.aborted) {
          setLookingUpPostalCode((current) =>
            current === postalCode ? null : current,
          );
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [step, postalCodeEdited, values.postalCode, form]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      noValidate
      className="mt-8 space-y-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((field) => (
          <form.Field name={field.key} key={field.key}>
            {(control) => (
              <Field
                className={
                  field.key === "legalName" ||
                  field.key === "contactEmail" ||
                  field.key === "street"
                    ? "sm:col-span-2"
                    : undefined
                }
              >
                <FieldLabel
                  htmlFor={field.key}
                  className={field.required ? "required" : undefined}
                >
                  {field.label}
                </FieldLabel>
                <div className="relative">
                  <Input
                    className={field.key === "postalCode" ? "pr-10" : undefined}
                    id={field.key}
                    name={control.name}
                    type={field.type ?? "text"}
                    inputMode={
                      field.key === "contactPhone" ||
                      field.key === "taxId" ||
                      field.key === "postalCode"
                        ? "numeric"
                        : undefined
                    }
                    maxLength={
                      field.key === "contactPhone"
                        ? 15
                        : field.key === "taxId"
                          ? 18
                          : undefined
                    }
                    placeholder={field.placeholder}
                    value={
                      field.key === "postalCode"
                        ? formatPostalCode(control.state.value)
                        : control.state.value
                    }
                    required={field.required}
                    aria-invalid={!control.state.meta.isValid}
                    disabled={
                      conflict ||
                      (field.key === "postalCode" &&
                        control.state.value.length === 8 &&
                        lookingUpPostalCode === control.state.value)
                    }
                    onBlur={control.handleBlur}
                    onChange={(event) => {
                      if (field.key === "postalCode") {
                        setPostalCodeEdited(true);
                        const postalCode = postalCodeDigits(event.target.value);
                        if (postalCode !== control.state.value) {
                          setLookingUpPostalCode(
                            postalCode.length === 8 ? postalCode : null,
                          );
                        }
                      }
                      control.handleChange(
                        field.key === "contactPhone"
                          ? formatPhoneWithAreaCode(event.target.value)
                          : field.key === "taxId"
                            ? formatCnpj(event.target.value)
                            : field.key === "postalCode"
                              ? postalCodeDigits(event.target.value)
                              : event.target.value,
                      );
                    }}
                  />
                  {field.key === "postalCode" &&
                    lookingUpPostalCode === control.state.value && (
                      <Spinner
                        aria-label="Consultando CEP"
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                    )}
                </div>
              </Field>
            )}
          </form.Field>
        ))}
      </div>
      <div className="flex items-center justify-end pt-2">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <Button
              type="submit"
              className={buttonClass}
              disabled={pending || conflict}
            >
              {pending ? "Salvando..." : "Continuar"}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
