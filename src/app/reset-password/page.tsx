import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={token} />;
}
