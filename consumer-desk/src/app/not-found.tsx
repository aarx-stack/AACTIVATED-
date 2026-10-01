import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-sm text-soft">That record does not exist or you do not have access to it.</p>
      <Link href="/" className="btn btn-primary mt-4">Back to Command Center</Link>
    </main>
  );
}
