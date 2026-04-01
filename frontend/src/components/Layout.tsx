import { ReactNode } from 'react';
import { motion } from 'framer-motion';

export function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="shell">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="glass">
        <h1>{title}</h1>
      </motion.header>
      <section className="panel">{children}</section>
    </main>
  );
}
