"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { createClinicAction } from "@/app/onboarding/clinic/actions";
import { chooseOrganization } from "@/app/select-organization/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { clinicInputSchema } from "@/lib/onboarding-clinic";

export function NewClinicSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { name: "" },
    validators: { onSubmit: clinicInputSchema.pick({ name: true }) },
    onSubmitInvalid: ({ value }) => {
      const parsed = clinicInputSchema.shape.name.safeParse(value.name);
      toast.error(
        parsed.success
          ? "Informe um nome válido para a clínica."
          : parsed.error.issues[0]?.message,
      );
    },
    onSubmit: async ({ value }) => {
      try {
        let slug = createdSlug;
        if (!slug) {
          const result = await createClinicAction(value);
          if (!result.ok) {
            toast.error(result.error.message);
            return;
          }
          slug = result.data.organization.slug;
          setCreatedSlug(slug);
        }

        if (!(await chooseOrganization(slug))) {
          toast.error(
            "Clínica criada, mas não foi possível selecioná-la. Tente novamente.",
          );
          return;
        }

        toast.success("Clínica criada com sucesso!");
        onCreated();
        onOpenChange(false);
        form.reset();
        setCreatedSlug(null);
        router.replace(`/app/${encodeURIComponent(slug)}/dashboard`);
      } catch {
        toast.error(
          "Não foi possível criar ou selecionar a clínica. Tente novamente.",
        );
      }
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      if (createdSlug) router.refresh();
      form.reset();
      setCreatedSlug(null);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="rounded-2xl border-0 data-[side=right]:inset-y-4 data-[side=right]:right-4 data-[side=right]:h-[calc(100dvh-2rem)] data-[side=right]:w-[calc(100vw-2rem)] data-[side=right]:border-l-0">
        <SheetHeader>
          <SheetTitle>Nova clínica</SheetTitle>
          <SheetDescription>
            Defina o nome da sua clínica para continuar.
          </SheetDescription>
        </SheetHeader>
        <form
          className="space-y-5 px-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="new-clinic-name" className="required">
                  Nome da clínica
                </FieldLabel>
                <Input
                  id="new-clinic-name"
                  name={field.name}
                  autoComplete="organization"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Ex.: Clínica Vida & Saúde"
                  aria-invalid={!field.state.meta.isValid}
                  maxLength={120}
                  disabled={Boolean(createdSlug)}
                  required
                />
              </Field>
            )}
          </form.Field>
          <div className="flex justify-end">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(pending) => (
                <Button type="submit" size="form" disabled={pending}>
                  {pending && <Spinner className="mr-2 size-4" />}
                  {createdSlug ? "Entrar na clínica" : "Criar clínica"}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
