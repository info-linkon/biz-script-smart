import { supabase } from '@/integrations/supabase/client';

export type VoiceProvider = 'elevenlabs' | 'vapi' | 'google';

export interface VoiceProviderConfig {
  provider: VoiceProvider;
  elevenlabs_agent_id?: string;
  vapi_assistant_id?: string;
  dialogflow_agent_id?: string;
}

/**
 * Get the current voice provider from the user's profile
 */
export async function getVoiceProvider(userId: string): Promise<VoiceProviderConfig> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('voice_provider, elevenlabs_agent_id, vapi_assistant_id, dialogflow_agent_id')
    .eq('user_id', userId)
    .single();

  if (error || !profile) {
    console.error('Error fetching voice provider:', error);
    return { provider: 'elevenlabs' }; // Default to ElevenLabs
  }

  return {
    provider: (profile.voice_provider as VoiceProvider) || 'elevenlabs',
    elevenlabs_agent_id: profile.elevenlabs_agent_id || undefined,
    vapi_assistant_id: profile.vapi_assistant_id || undefined,
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
  // ElevenLabs
  signed_url?: string;
  // Vapi
  public_key?: string;
  assistant_id?: string;
  // Google Dialogflow
  project_id?: string;
  access_token?: string;
  // Common
  agent_id?: string;
  error?: string;
}> {
  if (provider === 'google') {
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
  } else if (provider === 'vapi') {
    const { data, error } = await supabase.functions.invoke('vapi-get-token');
    
    if (error || !data) {
      console.error('Error getting Vapi credentials:', error);
      return { success: false, provider, error: error?.message || 'Failed to get Vapi credentials' };
    }

    return {
      success: true,
      provider: 'vapi',
      public_key: data.public_key,
      assistant_id: data.assistant_id,
      agent_id: data.assistant_id,
    };
  } else {
    // ElevenLabs
    const { data, error } = await supabase.functions.invoke('elevenlabs-conversation-token');
    
    if (error || !data) {
      console.error('Error getting ElevenLabs credentials:', error);
      return { success: false, provider, error: error?.message || 'Failed to get ElevenLabs credentials' };
    }

    return {
      success: true,
      provider: 'elevenlabs',
      signed_url: data.signed_url,
      agent_id: data.agent_id,
    };
  }
}

/**
 * Create or update an agent for the specified provider
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
  assistant_id?: string;
  error?: string;
}> {
  const functionMap: Record<VoiceProvider, string> = {
    elevenlabs: 'elevenlabs-create-agent',
    vapi: 'vapi-create-assistant',
    google: 'google-create-agent',
  };
  
  const functionName = functionMap[provider];
  
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: options || {}
  });

  if (error || !data?.success) {
    console.error(`Error creating ${provider} agent:`, error || data?.error);
    return { 
      success: false, 
      error: error?.message || data?.error || `Failed to create ${provider} agent` 
    };
  }

  return {
    success: true,
    agent_id: data.agent_id,
    assistant_id: data.assistant_id,
  };
}

/**
 * Update an existing agent for the specified provider
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
  const functionMap: Record<VoiceProvider, string> = {
    elevenlabs: 'elevenlabs-update-agent',
    vapi: 'vapi-update-assistant',
    google: 'google-update-agent',
  };
  
  const functionName = functionMap[provider];
  
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: {
      script_id: scriptId,
      ...options
    }
  });

  if (error || !data?.success) {
    console.error(`Error updating ${provider} agent:`, error || data?.error);
    return { 
      success: false, 
      error: error?.message || data?.error || `Failed to update ${provider} agent` 
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
  if (provider === 'google') {
    return {
      name: 'Google Dialogflow CX',
      nameEn: 'Google Dialogflow CX',
      description: 'זיהוי דיבור מעולה בעברית עם Chirp 3',
      icon: '🎯',
      pros: ['זיהוי עברית מצוין (Chirp 3)', 'עלות נמוכה', 'אמינות גבוהה', 'תמיכה בערבית'],
      cons: ['הגדרה מורכבת יותר', 'פחות קולות זמינים'],
    };
  }
  
  if (provider === 'vapi') {
    return {
      name: 'Vapi.ai',
      nameEn: 'Vapi.ai',
      description: 'תמיכה מלאה בעברית עם Deepgram STT + ElevenLabs TTS',
      icon: '🌍',
      pros: ['תמיכה מלאה בעברית', 'זיהוי דיבור מעולה', 'איכות קול גבוהה'],
      cons: ['זמן תגובה מעט ארוך יותר', 'עלות גבוהה יותר'],
    };
  }

  return {
    name: 'ElevenLabs',
    nameEn: 'ElevenLabs',
    description: 'מהיר ואיכותי, מתאים לאנגלית',
    icon: '⚡',
    pros: ['מהיר מאוד', 'עלות נמוכה יותר', 'קול טבעי'],
    cons: ['תמיכה מוגבלת בעברית'],
  };
}

/**
 * Get all available providers with their info
 */
export function getAllProviders(): Array<{ provider: VoiceProvider; info: ReturnType<typeof getProviderInfo> }> {
  const providers: VoiceProvider[] = ['elevenlabs', 'vapi', 'google'];
  return providers.map(p => ({
    provider: p,
    info: getProviderInfo(p)
  }));
}

/**
 * Check if an agent exists for the given provider
 */
export async function hasAgent(userId: string, provider: VoiceProvider): Promise<boolean> {
  const config = await getVoiceProvider(userId);
  
  switch (provider) {
    case 'google':
      return !!config.dialogflow_agent_id;
    case 'vapi':
      return !!config.vapi_assistant_id;
    case 'elevenlabs':
    default:
      return !!config.elevenlabs_agent_id;
  }
}
