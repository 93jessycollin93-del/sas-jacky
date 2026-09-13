-- Agent R&D Lab: cloud-backed agents.
-- Until now LabAgent lived only in localStorage — real per-browser, but lost
-- the moment you switch devices or clear storage. This gives it a real home.

CREATE TABLE public.lab_agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled agent',
  role TEXT NOT NULL DEFAULT '',
  system TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  context_budget INTEGER NOT NULL DEFAULT 8000,
  fallback BOOLEAN NOT NULL DEFAULT true,
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lab_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own lab agents" ON public.lab_agents
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_lab_agents_updated_at
  BEFORE UPDATE ON public.lab_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Prompt versions belong to a lab agent; deleting the agent drops its history.
CREATE TABLE public.lab_agent_prompt_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.lab_agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'untitled',
  system TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lab_agent_prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own lab agent prompt versions" ON public.lab_agent_prompt_versions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_lab_agent_prompt_versions_agent_id ON public.lab_agent_prompt_versions(agent_id);
