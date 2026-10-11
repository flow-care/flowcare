"use client";

import { useForm } from "@tanstack/react-form";
import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveOnboardingProfile } from "@/app/onboarding/profile/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type Profile,
  type ProfileInput,
  profileInput,
} from "@/lib/onboarding-profile";
import { formatPhoneWithAreaCode } from "@/lib/phone";

const buttonClass = "h-[46px] rounded-lg px-5 text-base font-normal";
const professionalRoles = {
  MANAGEMENT: "Gestão administrativa",
  CLINICAL: "Profissional clínico",
  RECEPTION: "Recepção",
} as const;

export function ProfileForm({ initialProfile }: { initialProfile: Profile }) {
  const router = useRouter();
  const form = useForm({
    defaultValues: {
      fullName: initialProfile.fullName,
      phone: formatPhoneWithAreaCode(initialProfile.phone ?? ""),
      professionalRole:
        initialProfile.professionalRole === "CLINICAL" ||
        initialProfile.professionalRole === "RECEPTION"
          ? initialProfile.professionalRole
          : "MANAGEMENT",
      professionalTitle: initialProfile.professionalTitle ?? "",
      registrationNumber: initialProfile.registrationNumber ?? "",
    } satisfies ProfileInput,
    validators: { onSubmit: profileInput },
    onSubmitInvalid: ({ value }) => {
      const parsed = profileInput.safeParse(value);
      toast.error(
        parsed.success
          ? "Confira os dados informados."
          : parsed.error.issues[0]?.message,
      );
    },
    onSubmit: async ({ value }) => {
      const result = await saveOnboardingProfile(value);
      if (result.ok) {
        toast.success("Perfil concluído com sucesso!");
        router.replace("/");
        return;
      }
      const firstError =
        result.fieldErrors && Object.values(result.fieldErrors)[0];
      toast.error(
        firstError || result.message || "Verifique os dados informados.",
      );
    },
  });

  return (
    <form
      className="mt-8 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      noValidate
    >
      <form.Field name="fullName">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="fullName" className="required">
              Nome completo
            </FieldLabel>
            <Input
              id="fullName"
              placeholder="Seu nome completo"
              name={field.name}
              autoComplete="name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={!field.state.meta.isValid}
              maxLength={120}
              required
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="phone">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="phone" className="required">
              Telefone com DDD
            </FieldLabel>
            <Input
              id="phone"
              placeholder="(85) 99999-9999"
              name={field.name}
              type="tel"
              autoComplete="tel"
              inputMode="numeric"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(formatPhoneWithAreaCode(event.target.value))
              }
              aria-invalid={!field.state.meta.isValid}
              maxLength={15}
              required
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="professionalRole">
        {(field) => (
          <Field>
            <FieldLabel
              id="professionalRole-label"
              htmlFor="professionalRole"
              className="required"
            >
              Atuação profissional
            </FieldLabel>
            <DropdownMenu>
              <DropdownMenuTrigger
                id="professionalRole"
                type="button"
                aria-labelledby="professionalRole-label"
                className="flex h-[47px] w-full cursor-pointer items-center justify-between rounded-lg border border-transparent bg-card px-3 text-base font-normal outline-none focus-visible:border-primary"
              >
                {professionalRoles[field.state.value]}
                <ChevronDownIcon className="size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as typeof field.state.value)
                  }
                >
                  <DropdownMenuRadioItem value="MANAGEMENT">
                    Gestão administrativa
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="CLINICAL">
                    Profissional clínico
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="RECEPTION">
                    Recepção
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>
        )}
      </form.Field>

      <form.Subscribe
        selector={(state) => state.values.professionalRole === "CLINICAL"}
      >
        {(clinical) =>
          clinical && (
            <>
              <form.Field name="professionalTitle">
                {(field) => (
                  <Field>
                    <FieldLabel
                      htmlFor="professionalTitle"
                      className="required"
                    >
                      Profissão ou especialidade
                    </FieldLabel>
                    <Input
                      id="professionalTitle"
                      placeholder="Ex.: Medicina"
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      aria-invalid={!field.state.meta.isValid}
                      maxLength={120}
                      required
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="registrationNumber">
                {(field) => (
                  <Field>
                    <FieldLabel
                      htmlFor="registrationNumber"
                      className="required"
                    >
                      Registro profissional
                    </FieldLabel>
                    <Input
                      id="registrationNumber"
                      name={field.name}
                      placeholder="Ex.: CRM/CE 123456"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      aria-invalid={!field.state.meta.isValid}
                      maxLength={80}
                      required
                    />
                  </Field>
                )}
              </form.Field>
            </>
          )
        }
      </form.Subscribe>
      <div className="flex justify-end">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <Button type="submit" disabled={pending} className={buttonClass}>
              {pending ? "Continuando..." : "Continuar"}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
