import { Task, ProjectConcept } from './types';

/**
 * MySQL Storage Service (Dual-write helper)
 * This service calls our local Express backend which then writes to MySQL.
 */

export const saveTaskToMySQL = async (task: Task): Promise<boolean> => {
  try {
    const response = await fetch('/api/mysql/save-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    });
    if (!response.ok) {
      console.warn('MySQL save failed (status):', response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error('MySQL save failed (error):', error);
    return false;
  }
};

export const saveProjectConceptToMySQL = async (concept: ProjectConcept): Promise<boolean> => {
  try {
    const response = await fetch('/api/mysql/save-concept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(concept)
    });
    return response.ok;
  } catch (error) {
    console.error('MySQL save concept failed:', error);
    return false;
  }
};

export const saveEpicsToMySQL = async (epics: string[]): Promise<boolean> => {
  try {
    const response = await fetch('/api/mysql/save-epics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epics })
    });
    return response.ok;
  } catch (error) {
    console.error('MySQL save epics failed:', error);
    return false;
  }
};

export const syncAllTasksToMySQL = async (tasks: Task[]): Promise<boolean> => {
  try {
    // We can just loop through and save each task, or create a bulk endpoint.
    // For simplicity and to avoid large payload issues, let's loop.
    // In a real production app, a bulk endpoint is better.
    let success = true;
    for (const task of tasks) {
      const ok = await saveTaskToMySQL(task);
      if (!ok) success = false;
    }
    return success;
  } catch (error) {
    console.error('MySQL sync all failed:', error);
    return false;
  }
};
