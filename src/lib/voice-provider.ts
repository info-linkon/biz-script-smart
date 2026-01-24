import { supabase } from '@/integrations/supabase/client';

export type VoiceProvider = 'google';

export interface VoiceProviderConfig {
  provider: VoiceProvider;
  dialogflow_agent_id?: string;
}

/**
 * Get the current voice provider from the user's profile
 */
export async function getVoiceProvider(userId: string): Promise<VoiceProviderConfig> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('voice_provider, dialogflow_agent_id')
    .eq('user_id', userId)
    .single();

  if (error || !profile) {
    console.error('Error fetching voice provider:', error);
    return { provider: 'google' };
  }

  return {
    provider: 'google',
    dialogflow_agent_id: (profile as any).dialogflow_agent_id || undefined,
  };
}

/**
 * Update the user's voice provider preference
 */
export async function setVoiceProvider(userId: string, provider: VoiceProvider): Promise<boolean> {
  const { error } = await supabase
    .from('profiles')
    .update({ voice_provider: provider })
    .eq('user_id', userId);

  if (error) {
    console.error('Error updating voice provider:', error);
    return false;
  }

  return true;
}

/**
 * Get the appropriate token/credentials for the current voice provider
 */
export async function getVoiceProviderCredentials(provider: VoiceProvider): Promise<{
  success: boolean;
  provider: VoiceProvider;
  // Google Dialogflow
  project_id?: string;
  access_token?: string;
  // Common
  agent_id?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke('google-get-credentials');
  
  if (error || !data) {
    console.error('Error getting Google credentials:', error);
    return { success: false, provider, error: error?.message || 'Failed to get Google credentials' };
  }

  return {
    success: true,
    provider: 'google',
    project_id: data.project_id,
    agent_id: data.agent_id,
    access_token: data.access_token,
  };
}

/**
 * Create or update an agent for Google Dialogflow
 */
export async function createOrUpdateAgent(
  provider: VoiceProvider,
  options?: {
    voice_id?: string;
    script_id?: string;
    business_name?: string;
    greeting_message?: string;
    custom_prompt?: string;
  }
): Promise<{
  success: boolean;
  agent_id?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke('google-create-agent', {
    body: options || {}
  });

  if (error || !data?.success) {
    console.error('Error creating Google agent:', error || data?.error);
    return { 
      success: false, 
      error: error?.message || data?.error || 'Failed to create Google agent' 
    };
  }

  return {
    success: true,
    agent_id: data.agent_id,
  };
}

/**
 * Update an existing agent for Google Dialogflow
 */
export async function updateAgent(
  provider: VoiceProvider,
  scriptId: string,
  options?: {
    voice_id?: string;
  }
): Promise<{
  success: boolean;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke('google-update-agent', {
    body: {
      script_id: scriptId,
      ...options
    }
  });

  if (error || !data?.success) {
    console.error('Error updating Google agent:', error || data?.error);
    return { 
      success: false, 
      error: error?.message || data?.error || 'Failed to update Google agent' 
    };
  }

  return { success: true };
}

/**
 * Get provider display info
 */
export function getProviderInfo(provider: VoiceProvider): {
  name: string;
  nameEn: string;
  description: string;
  icon: string;
  pros: string[];
  cons: string[];
} {
  return {
    name: 'Google Dialogflow CX',
    nameEn: 'Google Dialogflow CX',
    description: 'זיהוי דיבור מעולה בעברית עם Chirp 3',
    icon: '🎯',
    pros: ['זיהוי עברית מצוין (Chirp 3)', 'עלות נמוכה', 'אמינות גבוהה', 'תמיכה בערבית'],
    cons: ['הגדרה מורכבת יותר', 'פחות קולות זמינים'],
  };
}

/**
 * Get all available providers with their info
 */
export function getAllProviders(): Array<{ provider: VoiceProvider; info: ReturnType<typeof getProviderInfo> }> {
  return [{
    provider: 'google',
    info: getProviderInfo('google')
  }];
}

/**
 * Check if an agent exists for the given provider
 */
export async function hasAgent(userId: string, provider: VoiceProvider): Promise<boolean> {
  const config = await getVoiceProvider(userId);
  return !!config.dialogflow_agent_id;
}
