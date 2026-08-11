import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const evidence = z.object({
  src: z.string().startsWith('/assets/projects/'),
  alt: z.string().min(20),
  caption: z.string().min(20),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    shortTitle: z.string(),
    summary: z.string(),
    type: z.enum(['Group project', 'Individual design', 'Individual laboratory']),
    role: z.string(),
    tools: z.array(z.string()).min(2),
    order: z.number().int().positive(),
    featured: z.boolean(),
    overview: z.array(z.string()).min(1),
    contributions: z.array(z.string()).min(1),
    technicalApproach: z.array(z.string()).min(1),
    results: z.array(z.string()).min(1),
    evidence: z.array(evidence).min(2),
    reflection: z.array(z.string()).min(1),
  }),
});

const research = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/research' }),
  schema: z.object({
    title: z.string(),
    status: z.literal('Submitted manuscript \u2014 Under editorial review'),
    authorship: z.literal('First-author review manuscript'),
    summary: z.string(),
    scope: z.array(z.string()).min(3),
    order: z.number().int().positive(),
  }),
});

export const collections = { projects, research };
